require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');

const { DISCORD_TOKEN, GUILD_ID, VOICE_CHANNEL_ID } = process.env;

if (!DISCORD_TOKEN || !GUILD_ID || !VOICE_CHANNEL_ID) {
  console.error('❌ DISCORD_TOKEN, GUILD_ID, dan VOICE_CHANNEL_ID wajib diisi di file .env');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

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
    selfDeaf: false,
    selfMute: false,
  });

  // Bot tidak memutar audio apa pun -> otomatis tetap "diam" dan standby
  // di voice channel selama koneksi tidak diputus.

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    console.warn('🔌 Koneksi voice terputus, mencoba reconnect...');
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5000),
      ]);
      // Reconnect otomatis berhasil, biarkan berjalan
    } catch (err) {
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

  console.log(`✅ Berhasil join voice channel: ${channel.name} (standby diam)`);
}

client.once('ready', async () => {
  console.log(`🤖 Login sebagai ${client.user.tag}`);
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
