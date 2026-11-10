#!/usr/bin/env python3
"""Kiểm tra ảnh chụp màn hình (PNG 8 bit RGB/RGBA, không cần thư viện ngoài).

  pngcheck.py rightedge <ảnh.png>  -> in số điểm ảnh SÁNG ở 2 cột sát mép phải (từ 10% tới 90% chiều cao).
      Bố cục chưa co theo màn hình bị cắt ở mép phải nên có điểm sáng tại đây (chữ, nút, thanh HUD): đo trên máy ảo
      thật được 12-22 điểm; bố cục đúng — hoặc khung còn đang giấu — thì mép phải chỉ có nền tối: 0 điểm.
"""
import struct
import sys
import zlib


def load(path):
    d = open(path, 'rb').read()
    if d[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('không phải PNG')
    pos, idat, w, h, depth, ctype, inter = 8, b'', 0, 0, 0, 0, 0
    while pos + 8 <= len(d):
        n, typ = struct.unpack('>I4s', d[pos:pos + 8])
        body = d[pos + 8:pos + 8 + n]
        pos += 12 + n
        if typ == b'IHDR':
            w, h, depth, ctype, _, _, inter = struct.unpack('>IIBBBBB', body)
        elif typ == b'IDAT':
            idat += body
        elif typ == b'IEND':
            break
    if depth != 8 or inter != 0 or ctype not in (2, 6):
        raise ValueError('kiểu PNG không hỗ trợ (depth %d, color %d, interlace %d)' % (depth, ctype, inter))
    bpp = 3 if ctype == 2 else 4
    raw = zlib.decompress(idat)
    stride, rows, prev, i = w * bpp, [], bytearray(w * bpp), 0
    for _ in range(h):
        f = raw[i]
        line = bytearray(raw[i + 1:i + 1 + stride])
        i += 1 + stride
        if f == 1:
            for x in range(bpp, stride):
                line[x] = (line[x] + line[x - bpp]) & 255
        elif f == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 255
        elif f == 3:
            for x in range(stride):
                line[x] = (line[x] + (((line[x - bpp] if x >= bpp else 0) + prev[x]) >> 1)) & 255
        elif f == 4:
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                b = prev[x]
                c = prev[x - bpp] if x >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(line)
        prev = line
    return w, h, bpp, rows


def main():
    cmd, path = sys.argv[1], sys.argv[2]
    w, h, bpp, rows = load(path)
    if cmd == 'rightedge':
        n = 0
        for y in range(int(h * 0.10), int(h * 0.90)):
            for x in (w - 2, w - 1):
                r, g, b = rows[y][x * bpp:x * bpp + 3]
                if 0.299 * r + 0.587 * g + 0.114 * b > 80:
                    n += 1
        print(n)


if __name__ == '__main__':
    main()
