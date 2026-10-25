# Nexterm

Basit, renkli ve okunaklı bir SSH istemcisi (Electron + xterm.js + ssh2). Ücretsiz, açık kaynak kütüphanelerle.

## Çalıştırma

1. [Node.js](https://nodejs.org) (LTS) kurun.
2. Bu klasörde:

```
npm install
npm start
```

Kurulum paketi (.exe / .dmg / AppImage) için: `npm run dist`

## Özellikler

- Parola veya SSH anahtarıyla bağlantı, kayıtlı profiller, arama
- Sekmeli çoklu oturum (Ctrl+Tab ile geçiş, orta tuşla kapatma), her bağlantıya kendi rengi
- Koyu / açık tema, terminal yazı boyutu ayarı (Inter + JetBrains Mono yazı tipleri paketle birlikte gelir)
- Kopyala: Ctrl+Shift+C (seçim varken Ctrl+C), Yapıştır: Ctrl+Shift+V, sağ tık: kopyala/yapıştır
- **SFTP dosya gezgini** (üstte "Dosyalar"): klasör gezme, sürükle-bırak ile yükleme (dosya ve klasör), indirme, yeniden adlandırma, silme, yeni klasör, ilerleme çubuğu
- **Port yönlendirme** (üstte "Tüneller"): Yerel (-L) ve Uzak (-R) tüneller, aç/kapa anahtarı, bağlanınca otomatik başlatma
- **Güvenli parola deposu**: kaydedilen parolalar işletim sistemi deposuyla (Windows DPAPI / macOS Anahtar Zinciri / Linux libsecret) şifrelenir
- Sunucu parmak izi doğrulama: ilk bağlantıda onay sorar, değişirse bağlantıyı reddeder

## Notlar

- Tüneller sunucu tarafında `AllowTcpForwarding` kapalıysa çalışmaz.
- Yerel tüneller yalnızca `127.0.0.1` üzerinde dinler (ağdaki diğer cihazlar erişemez).
- Linux'ta güvenli parola deposu için bir anahtarlık servisi (gnome-keyring / KWallet) gerekir.
- Veriler Electron kullanıcı veri klasöründe (`profiles.json`, `known_hosts.json`) tutulur.
