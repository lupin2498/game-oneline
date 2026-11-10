import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/**
 * zipalign toi gian: can du lieu cua moi muc KHONG NEN (STORED) ve boi so 4 byte.
 * Android 11+ (targetSdk >= 30) tu choi cai APK neu resources.arsc bi nen hoac khong can 4 byte.
 *
 *   java Align vao.apk ra.apk     can chinh
 *   java Align --check tep.apk    kiem tra (ma thoat 0 = dat)
 */
public class Align {
    private static final int ALIGN = 4;
    private static final int PAD_ID = 0xd935;   // khoi "alignment" cua Android trong truong extra

    static final class Entry {
        int cdPos, cdLen;        // vi tri ban ghi trong central directory goc
        int method, flags;
        long crc, csize, usize, lfh;
        long newLfh;
        String name;
    }

    public static void main(String[] a) throws IOException {
        if (a.length == 2 && a[0].equals("--check")) {
            String bad = check(Files.readAllBytes(new File(a[1]).toPath()));
            if (bad != null) { System.err.println("CHUA CAN CHINH: " + bad); System.exit(1); }
            System.out.println("can chinh 4 byte: dat");
            return;
        }
        if (a.length != 2) { System.err.println("dung: Align vao.apk ra.apk | Align --check tep.apk"); System.exit(2); }
        byte[] out = align(Files.readAllBytes(new File(a[0]).toPath()));
        String bad = check(out);
        if (bad != null) throw new IOException("can chinh that bai: " + bad);
        FileOutputStream f = new FileOutputStream(a[1]);
        try { f.write(out); } finally { f.close(); }
    }

    static int u16(byte[] b, int o) { return (b[o] & 0xff) | ((b[o + 1] & 0xff) << 8); }
    static long u32(byte[] b, int o) { return u16(b, o) | ((long) u16(b, o + 2) << 16); }
    static void p16(ByteArrayOutputStream o, int v) { o.write(v & 0xff); o.write((v >>> 8) & 0xff); }
    static void p32(ByteArrayOutputStream o, long v) { p16(o, (int) (v & 0xffff)); p16(o, (int) ((v >>> 16) & 0xffff)); }

    static int findEocd(byte[] b) throws IOException {
        for (int i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
            if (u32(b, i) == 0x06054b50L && i + 22 + u16(b, i + 20) == b.length) return i;
        }
        throw new IOException("khong tim thay EOCD (khong phai tep zip?)");
    }

    static List<Entry> readCentral(byte[] b, int eocd) throws IOException {
        int n = u16(b, eocd + 10);
        int p = (int) u32(b, eocd + 16);
        List<Entry> list = new ArrayList<Entry>();
        for (int i = 0; i < n; i++) {
            if (u32(b, p) != 0x02014b50L) throw new IOException("central directory hong tai " + p);
            Entry e = new Entry();
            e.cdPos = p;
            e.flags = u16(b, p + 8);
            e.method = u16(b, p + 10);
            e.crc = u32(b, p + 16);
            e.csize = u32(b, p + 20);
            e.usize = u32(b, p + 24);
            int nl = u16(b, p + 28), xl = u16(b, p + 30), cl = u16(b, p + 32);
            e.lfh = u32(b, p + 42);
            e.name = new String(b, p + 46, nl, "UTF-8");
            e.cdLen = 46 + nl + xl + cl;
            if (e.csize == 0xffffffffL || e.lfh == 0xffffffffL) throw new IOException("zip64 khong ho tro");
            list.add(e);
            p += e.cdLen;
        }
        return list;
    }

    /** Giu lai cac khoi extra hop le, bo khoi can chinh cu va phan dem rac. */
    static byte[] cleanExtra(byte[] b, int off, int len) {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        int p = off, end = off + len;
        while (p + 4 <= end) {
            int id = u16(b, p), sz = u16(b, p + 2);
            if (p + 4 + sz > end) break;
            if (id != PAD_ID && id != 0) o.write(b, p, 4 + sz);
            p += 4 + sz;
        }
        return o.toByteArray();
    }

    static byte[] align(byte[] in) throws IOException {
        int eocd = findEocd(in);
        List<Entry> cd = readCentral(in, eocd);
        List<Entry> byOffset = new ArrayList<Entry>(cd);
        Collections.sort(byOffset, new Comparator<Entry>() {
            public int compare(Entry x, Entry y) { return x.lfh < y.lfh ? -1 : (x.lfh > y.lfh ? 1 : 0); }
        });
        ByteArrayOutputStream out = new ByteArrayOutputStream(in.length + 1024);
        for (Entry e : byOffset) {
            int l = (int) e.lfh;
            if (u32(in, l) != 0x04034b50L) throw new IOException("local header hong: " + e.name);
            int nl = u16(in, l + 26), xl = u16(in, l + 28);
            int data = l + 30 + nl + xl;
            byte[] extra = cleanExtra(in, l + 30 + nl, xl);
            e.newLfh = out.size();
            int pad = 0;
            if (e.method == 0) {
                int need = (ALIGN - (int) ((e.newLfh + 30 + nl + extra.length) % ALIGN)) % ALIGN;
                if (need != 0) { pad = need; while (pad < 6) pad += ALIGN; }   // khoi dem: 4 byte tieu de + 2 byte gia tri
            }
            p32(out, 0x04034b50L);
            out.write(in, l + 4, 2);                       // version needed
            p16(out, e.flags & ~0x0008);                   // khong dung data descriptor
            out.write(in, l + 8, 6);                       // method, time, date
            p32(out, e.crc); p32(out, e.csize); p32(out, e.usize);
            p16(out, nl); p16(out, extra.length + pad);
            out.write(in, l + 30, nl);
            out.write(extra, 0, extra.length);
            if (pad > 0) {
                p16(out, PAD_ID); p16(out, pad - 4); p16(out, ALIGN);
                for (int i = 6; i < pad; i++) out.write(0);
            }
            out.write(in, data, (int) e.csize);
        }
        long cdStart = out.size();
        for (Entry e : cd) {
            byte[] rec = new byte[e.cdLen];
            System.arraycopy(in, e.cdPos, rec, 0, e.cdLen);
            int fl = e.flags & ~0x0008;
            rec[8] = (byte) (fl & 0xff); rec[9] = (byte) ((fl >>> 8) & 0xff);
            long o = e.newLfh;
            rec[42] = (byte) (o & 0xff); rec[43] = (byte) ((o >>> 8) & 0xff);
            rec[44] = (byte) ((o >>> 16) & 0xff); rec[45] = (byte) ((o >>> 24) & 0xff);
            out.write(rec, 0, rec.length);
        }
        long cdSize = out.size() - cdStart;
        out.write(in, eocd, 12);
        p32(out, cdSize); p32(out, cdStart);
        out.write(in, eocd + 20, in.length - (eocd + 20));   // do dai chu thich + chu thich
        return out.toByteArray();
    }

    /** null neu moi muc khong nen deu can 4 byte; nguoc lai tra ve ten muc dau tien bi lech. */
    static String check(byte[] b) throws IOException {
        int eocd = findEocd(b);
        for (Entry e : readCentral(b, eocd)) {
            int l = (int) e.lfh;
            if (u32(b, l) != 0x04034b50L) return e.name + " (local header hong)";
            long data = l + 30 + u16(b, l + 26) + u16(b, l + 28);
            if (e.method == 0 && data % ALIGN != 0) return e.name + " @ " + data;
            if (e.name.equals("resources.arsc") && e.method != 0) return "resources.arsc bi nen";
        }
        return null;
    }
}
