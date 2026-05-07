import { Socket } from 'node:net';
import { fail } from '../errors/index.js';

export type TelnetPort = 8080 | 8085 | 8087;

export class TelnetClient {
  /** One-shot read: connect, capture for `seconds`, return all lines. */
  async tail(host: string, port: TelnetPort, seconds: number): Promise<string[]> {
    const sock = await this.connect(host, port);
    return new Promise<string[]>((resolve, reject) => {
      const lines: string[] = [];
      let buf = '';
      sock.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          lines.push(buf.slice(0, i));
          buf = buf.slice(i + 1);
        }
      });
      sock.on('error', (err) => reject(err));
      const t = setTimeout(() => {
        sock.destroy();
        if (buf) lines.push(buf);
        resolve(lines);
      }, seconds * 1000);
      sock.on('close', () => { clearTimeout(t); resolve(lines); });
    });
  }

  private connect(host: string, port: TelnetPort): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const s = new Socket();
      s.setNoDelay(true);
      let opened = false;
      s.once('connect', () => { opened = true; resolve(s); });
      // Heuristic for LOG_TAIL_BUSY on telnet 8085: Roku accepts the TCP
      // connection then immediately closes it when a second client arrives.
      // We surface that as LOG_TAIL_BUSY only on 8085 within 100ms of connect.
      let closeWatch: NodeJS.Timeout | undefined;
      s.once('connect', () => {
        if (port !== 8085) return;
        closeWatch = setTimeout(() => closeWatch && (closeWatch = undefined), 100);
      });
      s.once('close', (hadError) => {
        if (opened && closeWatch && hadError) {
          reject(fail('LOG_TAIL_BUSY', `telnet ${host}:8085 closed immediately; another client likely connected`));
        }
      });
      s.once('error', (err) => {
        const e = err as NodeJS.ErrnoException;
        if (e.code === 'EADDRINUSE') {
          reject(fail('LOG_TAIL_BUSY', `port ${port} on ${host} already in use`));
        } else if (e.code === 'ECONNREFUSED' || e.code === 'EHOSTUNREACH' || e.code === 'ENETUNREACH') {
          reject(fail('DEVICE_UNREACHABLE', `telnet ${host}:${port}: ${e.code}`));
        } else if (e.code === 'ETIMEDOUT') {
          reject(fail('DEVICE_UNREACHABLE', `telnet ${host}:${port} timed out`));
        } else {
          reject(fail('DEVICE_UNREACHABLE', `telnet ${host}:${port}: ${e.message}`));
        }
      });
      s.connect(port, host);
    });
  }
}

export class LogStream {
  private buf: string[] = [];
  private dropped = 0;
  private socket?: Socket;
  private idleTimer?: NodeJS.Timeout;
  private closed = false;
  private maxLines = 65_536;
  private idleMs = 60_000;

  static async open(host: string, port: TelnetPort): Promise<LogStream> {
    const ls = new LogStream();
    const sock = await new TelnetClient()['connect'](host, port);
    ls.socket = sock;
    let pending = '';
    sock.on('data', (chunk) => {
      pending += chunk.toString('utf8');
      let i;
      while ((i = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, i);
        pending = pending.slice(i + 1);
        ls.push(line);
      }
    });
    sock.on('close', () => { ls.closed = true; });
    sock.on('error', () => { ls.closed = true; });
    ls.armIdle();
    return ls;
  }

  // Library-level return shape matches the spec's canonical wire shape (§4.3,
  // §4.6 in-band warnings table): warnings live under `details.warnings`.
  read(): {
    lines: string[];
    details?: { warnings: { code: 'LOG_STREAM_OVERFLOW'; dropped_lines: number; message: string }[] };
  } {
    if (this.closed && this.buf.length === 0) {
      throw fail('LOG_STREAM_TIMED_OUT', 'log stream is closed');
    }
    this.armIdle();
    const lines = this.buf;
    this.buf = [];
    if (this.dropped > 0) {
      const out = {
        lines,
        details: {
          warnings: [{
            code: 'LOG_STREAM_OVERFLOW' as const,
            dropped_lines: this.dropped,
            message: `dropped ${this.dropped} lines: consumer fell behind producer`,
          }],
        },
      };
      this.dropped = 0;
      return out;
    }
    return { lines };
  }

  close(): void {
    this.closed = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.socket?.destroy();
  }

  private push(line: string): void {
    if (this.buf.length >= this.maxLines) {
      this.buf.shift();
      this.dropped++;
    }
    this.buf.push(line);
  }

  private armIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.close(), this.idleMs);
  }
}
