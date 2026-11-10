#!/usr/bin/env python3
"""Kiểm tra tĩnh file IPA (chạy được trên Linux/macOS/Windows, chỉ cần Python 3):

    python3 tests/ios/verify-ipa.py dist/OneLine-1.6-unsigned.ipa

Mã thoát: 0 = đạt; 1 = IPA hỏng / sai cấu trúc; 3 = IPA hợp lệ nhưng nội dung web bên trong CŨ hơn repo
(sửa game xong phải lấy IPA mới: artifact "ios" của CI, hoặc chạy bash ios/build-ipa.sh trên máy Mac).
"""
import os
import plistlib
import re
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WEB = ['index.html', 'firebase-config.js', 'privacy.html', 'lib/online.js', 'icons/icon-192.png', 'icons/apple-touch-icon.png']
fail = []
stale = []


def ok(name, cond, detail=''):
    print(('PASS  ' if cond else 'FAIL  ') + name + (('  — ' + detail) if detail else ''))
    if not cond:
        fail.append(name)


def main():
    path = sys.argv[1]
    z = zipfile.ZipFile(path)
    names = z.namelist()
    apps = sorted(set(n.split('/')[1] for n in names if n.startswith('Payload/') and n.count('/') >= 2 and n.split('/')[1].endswith('.app')))
    ok('I1 Cấu trúc Payload/<tên>.app', len(apps) == 1, ', '.join(apps))
    if len(apps) != 1:
        return
    app = 'Payload/' + apps[0] + '/'
    info = plistlib.loads(z.read(app + 'Info.plist'))
    yml = open(os.path.join(ROOT, 'ios', 'project.yml'), encoding='utf-8').read()
    ver = re.search(r'MARKETING_VERSION: "([^"]+)"', yml).group(1)
    build = re.search(r'CURRENT_PROJECT_VERSION: "([^"]+)"', yml).group(1)
    ok('I2 Gói vn.lupin.oneline', info.get('CFBundleIdentifier') == 'vn.lupin.oneline', str(info.get('CFBundleIdentifier')))
    same = (info.get('CFBundleShortVersionString') == ver and str(info.get('CFBundleVersion')) == build
            and ("var VERSION='%s'" % ver) in open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read())
    print(('PASS  ' if same else 'CŨ    ') + 'I3 Phiên bản %s (%s) khớp ios/project.yml và trang web  — IPA %s (%s)'
          % (ver, build, info.get('CFBundleShortVersionString'), info.get('CFBundleVersion')))
    if not same:
        stale.append('phiên bản')
    ok('I4 Tên hiển thị, iOS tối thiểu, iPhone + iPad',
       info.get('CFBundleDisplayName') == 'Một Nét' and info.get('MinimumOSVersion') == '13.0' and sorted(info.get('UIDeviceFamily', [])) == [1, 2],
       '%s, iOS %s, %s' % (info.get('CFBundleDisplayName'), info.get('MinimumOSVersion'), info.get('UIDeviceFamily')))
    exe = z.read(app + info.get('CFBundleExecutable', '?'))[:8]
    ok('I5 Tệp chạy là Mach-O 64 bit cho arm64 (iPhone/iPad thật)', exe == bytes.fromhex('cffaedfe0c000001'), exe.hex())
    signed = [n for n in names if '/_CodeSignature/' in n or n.endswith('embedded.mobileprovision')]
    ok('I6 Chưa ký (Sideloadly / AltStore / Xcode sẽ ký khi cài), không kèm chứng chỉ của ai', not signed, ', '.join(signed[:3]))
    miss = [f for f in ['Assets.car'] + ['www/' + w for w in WEB] if (app + f) not in names]
    ok('I7 Đủ icon và các tệp web của game', not miss, 'thiếu: ' + ', '.join(miss) if miss else '')
    junk = [n for n in names if re.search(r'(\.p12|\.mobileprovision|/tests/|/node_modules/|login\.html|\.map)$', n)]
    ok('I8 Không lẫn khoá ký, mã nguồn test hay file thừa', not junk, ', '.join(junk[:3]))
    diff = [w for w in WEB if (app + 'www/' + w) in names and z.read(app + 'www/' + w) != open(os.path.join(ROOT, w), 'rb').read()]
    print(('PASS  ' if not diff else 'CŨ    ') + 'I9 Nội dung web trong IPA giống hệt bản trong repo' + (('  — khác: ' + ', '.join(diff)) if diff else ''))
    stale.extend(diff)


main()
if fail:
    print('==> IPA: CÓ LỖI')
    sys.exit(1)
if stale:
    print('==> IPA hợp lệ nhưng CŨ hơn mã nguồn: lấy IPA mới từ artifact "ios" của CI hoặc chạy bash ios/build-ipa.sh trên máy Mac')
    sys.exit(3)
print('==> IPA tĩnh: tất cả đạt')
