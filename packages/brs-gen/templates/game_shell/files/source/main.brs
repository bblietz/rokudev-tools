' STUB: Plan 4f Task 2 placeholder; Task 4 overwrites this file with the canonical message-pump per spec §5.2.
sub Main()
  screen = CreateObject("roSGScreen")
  m.port = CreateObject("roMessagePort")
  screen.setMessagePort(m.port)
  scene = screen.CreateScene("GameScene")
  screen.show()
  while true
    msg = wait(0, m.port)
    if type(msg) = "roSGScreenEvent" and msg.isScreenClosed() then return
  end while
end sub
