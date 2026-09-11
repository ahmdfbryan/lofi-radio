require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits } = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  NoSubscriberBehavior,
  StreamType,
} = require('@discordjs/voice');
const ffmpegPath = require('ffmpeg-static');
process.env.FFMPEG_PATH = ffmpegPath;

const {
  DISCORD_TOKEN,
  GUILD_ID,
  VOICE_CHANNEL_ID,
  MODE = 'local',
  STREAM_URL,
  VOLUME = '0.5',
} = process.env;

if (!DISCORD_TOKEN || !GUILD_ID || !VOICE_CHANNEL_ID) {
  console.error('❌ DISCORD_TOKEN, GUILD_ID, dan VOICE_CHANNEL_ID wajib diisi di file .env');
  process.exit(1);
}

const MUSIC_DIR = path.join(__dirname, 'music');

// -------- Client Discord --------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// -------- Audio Player --------
// NoSubscriberBehavior.Play -> tetap "memutar" walau tidak ada yang subscribe/dengar,
// supaya bot tetap standby dan tidak berhenti sendiri saat channel kosong.
const player = createAudioPlayer({
  behaviors: {
    noSubscriber: NoSubscriberBehavior.Play,
  },
});

let currentConnection = null;
let playlist = [];
let currentIndex = -1;

function loadPlaylist() {
  if (!fs.existsSync(MUSIC_DIR)) {
    fs.mkdirSync(MUSIC_DIR, { recursive: true });
  }
  playlist = fs
    .readdirSync(MUSIC_DIR)
    .filter((f) => /\.(mp3|ogg|wav|flac|m4a)$/i.test(f))
    .map((f) => path.join(MUSIC_DIR, f));
}

function pickNextTrack() {
  if (playlist.length === 0) return null;
  if (playlist.length === 1) return playlist[0];
  let idx;
  do {
    idx = Math.floor(Math.random() * playlist.length);
  } while (idx === currentIndex);
  currentIndex = idx;
  return playlist[idx];
}

function playLocalNext() {
  const track = pickNextTrack();
  if (!track) {
    console.warn('⚠️  Tidak ada file audio di folder ./music. Tambahkan file .mp3 lalu restart bot.');
    return;
  }
  console.log(`🎵 Memutar: ${path.basename(track)}`);
  const resource = createAudioResource(track, {
    inlineVolume: true,
  });
  resource.volume?.setVolume(parseFloat(VOLUME));
  player.play(resource);
}

function playStream() {
  if (!STREAM_URL) {
    console.error('❌ MODE=stream tapi STREAM_URL belum diisi di .env');
    return;
  }
  console.log(`📡 Menyambung ke stream: ${STREAM_URL}`);
  const resource = createAudioResource(STREAM_URL, {
    inputType: StreamType.Arbitrary,
    inlineVolume: true,
  });
  resource.volume?.setVolume(parseFloat(VOLUME));
  player.play(resource);
}

function playNext() {
  if (MODE === 'stream') {
    playStream();
  } else {
    playLocalNext();
  }
}

// Saat trek selesai -> otomatis putar lagi (loop tanpa henti)
player.on(AudioPlayerStatus.Idle, () => {
  playNext();
});

player.on('error', (error) => {
  console.error('⚠️  Player error, mencoba lanjut ke trek berikutnya:', error.message);
  setTimeout(playNext, 2000);
});

// -------- Voice Connection & Auto-Reconnect --------
async function connectToVoice() {
  const guild = await client.guilds.fetch(GUILD_ID);
  const channel = await guild.channels.fetch(VOICE_CHANNEL_ID);

  if (!channel || !channel.isVoiceBased()) {
    console.error('❌ VOICE_CHANNEL_ID tidak valid atau bukan voice channel.');
    return;
  }

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false, // biar tidak auto-deaf (opsional, bisa diubah ke true)
    selfMute: false,
  });

  currentConnection = connection;
  connection.subscribe(player);

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    console.warn('🔌 Koneksi voice terputus, mencoba reconnect...');
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5000),
      ]);
      // Kemungkinan reconnect otomatis oleh discord.js, biarkan berjalan
    } catch (err) {
      // Reconnect otomatis gagal -> hancurkan koneksi lama dan join ulang manual
      console.warn('🔁 Reconnect otomatis gagal, join ulang secara manual...');
      try {
        connection.destroy();
      } catch (_) {}
      setTimeout(connectToVoice, 5000);
    }
  });

  connection.on(VoiceConnectionStatus.Destroyed, () => {
    console.warn('💥 Koneksi voice dihancurkan, join ulang dalam 5 detik...');
    setTimeout(connectToVoice, 5000);
  });

  connection.on('error', (err) => {
    console.error('⚠️  Voice connection error:', err.message);
  });

  console.log(`✅ Berhasil join voice channel: ${channel.name}`);

  if (player.state.status !== AudioPlayerStatus.Playing) {
    playNext();
  }
}

// -------- Ready --------
client.once('ready', async () => {
  console.log(`🤖 Login sebagai ${client.user.tag}`);
  loadPlaylist();
  await connectToVoice();
});

// Cegah proses mati karena error tak tertangani (penting untuk 24/7 di VPS)
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

client.login(DISCORD_TOKEN);
