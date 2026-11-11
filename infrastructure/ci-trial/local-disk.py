"""Trusted setup/cleanup helper, never run by the GitHub job.

Only the operation's backing volume and one preselected free loop device are exposed.
The caller supplies SYS_ADMIN for loop ioctls, not a Docker socket or host workspace.
"""
import errno
import fcntl
import json
import os
import re
import struct
import subprocess
import sys

mode, device, size = sys.argv[1:]
assert mode in ('create', 'clear') and re.fullmatch(r'/dev/loop[0-9]+', device)
size = int(size)
assert size in (268435456, 8589934592)
path = '/disk/scratch.ext4'
loop = os.open(device, os.O_RDWR)

def status():
    try:
        data = fcntl.ioctl(loop, 0x4C05, bytes(232))  # LOOP_GET_STATUS64
        return struct.unpack_from('=QQ', data)  # backing device, inode
    except OSError as error:
        if error.errno == errno.ENXIO:
            return None
        raise

try:
    if mode == 'create':
        assert status() is None, 'Loop device is no longer free'
        file = os.open(path, os.O_CREAT | os.O_EXCL | os.O_RDWR, 0o600)
        attached = False
        try:
            os.posix_fallocate(file, 0, size)
            identity = os.fstat(file)
            fcntl.ioctl(loop, 0x4C00, file)  # LOOP_SET_FD; do not autoclear before Docker mounts it
            attached = True
            assert status() == (identity.st_dev, identity.st_ino)
            subprocess.run(['/usr/sbin/mkfs.ext4', '-q', '-F', device], check=True)
            print(json.dumps({'loop': device, 'backingDevice': identity.st_dev,
                              'backingInode': identity.st_ino, 'maximumBytes': size}))
        except BaseException:
            if attached:
                fcntl.ioctl(loop, 0x4C01)  # LOOP_CLR_FD
            os.unlink(path)
            raise
        finally:
            os.close(file)
    else:
        active = status()
        if active is not None:
            identity = os.stat(path)
            assert active == (identity.st_dev, identity.st_ino), 'Refusing another backing image'
            fcntl.ioctl(loop, 0x4C01)
        assert status() is None, 'Loop device remains attached'
        if os.path.exists(path):
            os.unlink(path)
        print(json.dumps({'loop': device, 'loopCleared': True, 'backingFileAbsent': True}))
finally:
    os.close(loop)
