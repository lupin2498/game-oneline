import com.android.apksig.ApkSigner;
import java.io.File;
import java.io.FileInputStream;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.util.Collections;

/** Ky APK theo v1 (JAR) + v2 (APK Signature Scheme) bang thu vien apksig. */
public class Sign {
    public static void main(String[] args) throws Exception {
        File in = new File(args[0]);
        File out = new File(args[1]);
        String ksPath = args[2], pass = args[3], alias = args[4];
        int minSdk = Integer.parseInt(args[5]);

        KeyStore ks = KeyStore.getInstance("PKCS12");
        FileInputStream fis = new FileInputStream(ksPath);
        try {
            ks.load(fis, pass.toCharArray());
        } finally {
            fis.close();
        }

        PrivateKey key = (PrivateKey) ks.getKey(alias, pass.toCharArray());
        X509Certificate cert = (X509Certificate) ks.getCertificate(alias);

        ApkSigner.SignerConfig cfg =
                new ApkSigner.SignerConfig.Builder("CERT", key, Collections.singletonList(cert)).build();

        new ApkSigner.Builder(Collections.singletonList(cfg))
                .setInputApk(in)
                .setOutputApk(out)
                .setMinSdkVersion(minSdk)
                .setV1SigningEnabled(false)   // apksig 2.3.0 không chạy v1 trên JDK 17+
                .setV2SigningEnabled(true)
                .setCreatedBy("one-line-game build.sh")
                .build()
                .sign();

        System.out.println("signed: " + out.getName());
    }
}
