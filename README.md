# Lofi Radio Bot 🎧

Bot Discord yang standby 24 jam di satu voice channel dan memutar musik lofi terus-menerus, walaupun tidak ada member lain di channel tersebut.

## Fitur
- Join otomatis ke voice channel yang ditentukan saat bot start.
- Memutar audio secara **loop tanpa henti**, walau voice channel kosong (tidak akan auto-disconnect karena sepi).
- **Auto-reconnect** kalau koneksi voice putus (misal karena masalah jaringan sesaat).
- Anti-crash: error di-catch supaya proses Node tidak mati mendadak.
- Mendukung 2 mode audio:
  - `local`: memutar file mp3/ogg/wav kamu sendiri dari folder `music/` secara acak & berulang.
  - `stream`: menyambung ke URL internet radio (Icecast/Shoutcast) yang legal.

## 1. Persiapan Bot di Discord Developer Portal
1. Buka https://discord.com/developers/applications → **New Application**.
2. Masuk tab **Bot** → klik **Reset Token** → salin token (ini untuk `DISCORD_TOKEN`).
3. Di tab **Bot**, aktifkan **Server Members Intent** tidak wajib, tapi pastikan bot punya izin dasar.
4. Di tab **OAuth2 → URL Generator**:
   - Scope: `bot`
   - Permission: `Connect`, `Speak`, `View Channel`
   - Buka URL yang dihasilkan untuk invite bot ke server kamu.
5. Ambil **Guild ID** (klik kanan nama server → Copy Server ID, aktifkan Developer Mode dulu di Discord).
6. Ambil **Voice Channel ID** (klik kanan voice channel → Copy Channel ID).

## 2. Setup di VPS (Ubuntu/Debian)

```bash
# Update sistem & install Node.js (v18+) dan ffmpeg
sudo apt update
sudo apt install -y ffmpeg curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Cek versi
node -v
npm -v
```

Upload folder project ini ke VPS (via `scp`, `git clone`, atau FTP), lalu:

```bash
cd lofi-radio-bot
npm install
cp .env.example .env
nano .env   # isi DISCORD_TOKEN, GUILD_ID, VOICE_CHANNEL_ID, dll
```

### Menyediakan musik (mode local — direkomendasikan)
Masukkan file `.mp3` lofi milikmu sendiri (royalty-free / lisensi yang kamu miliki) ke folder `music/`. Bot akan memutar semuanya secara acak dan berulang tanpa henti.

> ⚠️ Catatan hak cipta: jangan gunakan lagu berhak cipta tanpa izin. Gunakan musik lofi royalty-free (contoh sumber: Pixabay Music, YouTube Audio Library, atau musik buatan sendiri) agar aman dipakai 24/7 di server publik.

### Mode stream (opsional)
Jika kamu punya URL stream radio Icecast/Shoutcast yang legal (misal radio lofi komunitas yang menyediakan streaming resmi), set:
```
MODE=stream
STREAM_URL=https://url-stream-radio-kamu.mp3
```

## 3. Jalankan Bot

Test dulu secara manual:
```bash
npm start
```

Jika sudah jalan (bot join voice channel), matikan dengan `Ctrl+C`, lalu jalankan permanen pakai **PM2** supaya tetap hidup 24 jam walau SSH ditutup atau VPS restart:

```bash
sudo npm install -g pm2
pm2 start index.js --name lofi-radio-bot
pm2 save
pm2 startup   # ikuti instruksi yang muncul untuk auto-start saat VPS reboot
```

Perintah PM2 yang berguna:
```bash
pm2 logs lofi-radio-bot     # lihat log realtime
pm2 restart lofi-radio-bot  # restart bot
pm2 stop lofi-radio-bot     # hentikan bot
```

## Struktur Project
```
lofi-radio-bot/
├── index.js          # kode utama bot
├── package.json
├── .env.example      # contoh konfigurasi (salin jadi .env)
├── music/            # taruh file mp3 lofi kamu di sini (mode local)
└── README.md
```

## Kenapa bot bisa bertahan walau voice kosong?
Secara default, `@discordjs/voice` akan tetap memutar audio (`NoSubscriberBehavior.Play`) meskipun tidak ada member yang mendengarkan, dan bot **tidak** diberi logika auto-leave saat channel sepi — jadi ia akan terus standby. Ditambah dengan auto-reconnect dan penanganan error global, proses Node.js akan tetap hidup selama dijalankan lewat PM2 di VPS.
