#!/usr/bin/env python3
"""Đọc tệp XML của `uiautomator dump` (cây trợ năng của màn hình đang hiện).

  uidump.py find   <ui.xml> <chữ>   -> in "x y" là tâm của nút mang đúng chữ đó (không có thì không in gì);
                                       <chữ> bắt đầu bằng "~" thì chỉ cần nút CHỨA phần chữ sau dấu "~"
  uidump.py dialog <ui.xml>         -> nếu màn hình đang là một hộp thoại của hệ thống che mất app (lời nhắc
                                       "Viewing full screen" lần đầu vào chế độ toàn màn hình, "... isn't
                                       responding", "... keeps stopping"): in "x y" của nút đóng nó
  uidump.py texts  <ui.xml>         -> in vài dòng chữ đang hiện (để chẩn đoán khi không tìm thấy nút)
"""
import html
import re
import sys


SYSTEM = ('android', 'com.android.systemui')
# nút đóng, theo thứ tự ưu tiên: lời nhắc toàn màn hình, hộp thoại "không phản hồi", hộp thoại lỗi
DISMISS = ('got it', 'đã hiểu', 'wait', 'đợi', 'close app', 'đóng ứng dụng', 'ok')


def nodes(path):
    try:
        xml = open(path, encoding='utf-8', errors='replace').read()
    except Exception:
        return
    for m in re.finditer(r'<node[^>]*>', xml):
        n = m.group(0)
        t = re.search(r' text="([^"]*)"', n)
        d = re.search(r' content-desc="([^"]*)"', n)
        b = re.search(r'bounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"', n)
        p = re.search(r' package="([^"]*)"', n)
        if not b:
            continue
        x0, y0, x1, y1 = map(int, b.groups())
        yield {
            'text': html.unescape(t.group(1)) if t else '',
            'desc': html.unescape(d.group(1)) if d else '',
            'pkg': p.group(1) if p else '',
            'box': (x0, y0, x1, y1),
        }


def center(n):
    x0, y0, x1, y1 = n['box']
    return '%d %d' % ((x0 + x1) // 2, (y0 + y1) // 2)


def visible(n):
    x0, y0, x1, y1 = n['box']
    return x1 > x0 and y1 > y0


def main():
    cmd, path = sys.argv[1], sys.argv[2]
    ns = [n for n in nodes(path) if visible(n)]
    if cmd == 'find':
        want = sys.argv[3]
        for n in ns:
            if (want[1:] in n['text'] or want[1:] in n['desc']) if want.startswith('~') else (n['text'] == want or n['desc'] == want):
                print(center(n))
                return
    elif cmd == 'dialog':
        # chỉ xét cửa sổ của chính hệ thống; cửa sổ của app (hay trình duyệt) thì không đụng tới
        if not ns or any(n['pkg'] not in SYSTEM for n in ns if n['pkg']):
            return
        for want in DISMISS:
            for n in ns:
                if n['text'].strip().lower() == want:
                    print(center(n))
                    return
    elif cmd == 'texts':
        seen = []
        for n in ns:
            s = (n['text'] or n['desc']).strip()
            if s and s not in seen:
                seen.append(s)
        pk = sorted(set(n['pkg'] for n in ns if n['pkg']))
        print('%d nút, gói %s, chữ: %s' % (len(ns), ','.join(pk) or '?', ' | '.join(seen[:8]) or '(không có)'))


if __name__ == '__main__':
    main()
