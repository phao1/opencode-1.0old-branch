"""Own a test PTY, emulate terminal query replies, and exchange JSON controls.

This controls an independent test process, not the user's Terminal.app window.
Only synthetic test sessions are captured.
"""
import base64, errno, fcntl, json, os, pathlib, pty, re, select, signal, struct, subprocess, sys, termios, time

binary, project, port, capture = sys.argv[1:5]
master, slave = pty.openpty()
fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',38,128,0,0))
def own_terminal():
    os.setsid();fcntl.ioctl(0,termios.TIOCSCTTY,0)
args=[binary,'--project',project]
if port!='none':args+=['--port',port,'--hostname','127.0.0.1']
p=subprocess.Popen(args,stdin=slave,stdout=slave,stderr=slave,cwd=project,preexec_fn=own_terminal)
os.close(slave)
def emit(value):print(json.dumps(value),flush=True)
def send(data):
    view=memoryview(data)
    while view:
        try:view=view[os.write(master,view):]
        except OSError as exc:
            if exc.errno==errno.EIO:return
            raise
emit(dict(type='started',pid=p.pid))
control=b''; pending=b''; replies=0; started=time.monotonic()
capture_file=open(capture,'wb')
try:
    while p.poll() is None and time.monotonic()-started<900:
        readable,_,_=select.select([master,0],[],[],.1)
        if master in readable:
            try:data=os.read(master,262144)
            except OSError as exc:
                if exc.errno==errno.EIO:break
                raise
            if not data:break
            capture_file.write(data);capture_file.flush()
            emit(dict(type='screen',data=base64.b64encode(data).decode()))
            pending+=data
            while True:
                match=re.search(rb'\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\))',pending)
                if not match:
                    esc=pending.rfind(b'\x1b');pending=pending[esc:] if esc>=0 else b''
                    break
                command=match[0];pending=pending[match.end():];reply=None
                if command==b'\x1b]11;?\x07':reply=b'\x1b]11;rgb:0000/0000/0000\x07'
                elif command==b'\x1b[c':reply=b'\x1b[?1;2c'
                elif command==b'\x1b[6n':reply=b'\x1b[1;2R'
                elif command==b'\x1b[14t':reply=b'\x1b[4;640;960t'
                elif command.endswith(b'$p'):
                    m=re.match(rb'\x1b\[\?(\d+)\$p',command)
                    if m:reply=b'\x1b[?'+m[1]+b';'+(b'2' if m[1] in (b'1004',b'2004') else b'0')+b'$y'
                elif command.startswith(b'\x1b]4;') and b';?' in command:
                    index=command.split(b';')[1]
                    reply=b'\x1b]4;'+index+b';rgb:'+(b'0000/0000/0000' if index==b'0' else b'aaaa/aaaa/aaaa')+b'\x07'
                if reply:send(reply);replies+=1
        if 0 in readable:
            chunk=os.read(0,65536)
            if not chunk:break
            control+=chunk
            while b'\n' in control:
                line,control=control.split(b'\n',1)
                command=json.loads(line)
                if command['type']=='keys':send(command['text'].encode())
                elif command['type']=='resize':
                    fcntl.ioctl(master,termios.TIOCSWINSZ,struct.pack('HHHH',command['rows'],command['cols'],0,0));os.killpg(p.pid,signal.SIGWINCH)
                elif command['type']=='close':os.killpg(p.pid,signal.SIGTERM)
                emit(dict(type='ack',id=command.get('id')))
finally:
    capture_file.close();os.close(master)
    try:p.wait(timeout=3)
    except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait(timeout=3)
    emit(dict(type='exit',code=p.returncode,terminalReplies=replies))
