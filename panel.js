// ============================================================
//  Voice Control Panel
//  Panel tombol: Rename, Status, Lock, Unlock, Manage,
//  Transfer Owner untuk voice channel tempat bot standby.
// ============================================================
const fs = require('fs');
const path = require('path');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  PermissionFlagsBits,
  OverwriteType,
  SlashCommandBuilder,
  MessageFlags,
} = require('discord.js');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'panel.json');

// Discord membatasi rename channel: 2x per 10 menit per channel
const RENAME_LIMIT = 2;
const RENAME_WINDOW_MS = 10 * 60 * 1000;
const renameHistory = [];

let cfg = {};
let refreshTimer = null;

// Owner panel = 1 user ID. Awalnya dari .env PANEL_OWNER_ID, bisa dipindah
// lewat tombol Transfer Owner (disimpan di data/panel.json).
// Kalau PANEL_OWNER_ID di .env diganti, owner ikut di-reset ke ID baru itu.
function envOwnerId() {
  return (process.env.PANEL_OWNER_ID || '').trim();
}
function getOwnerId() {
  const env = envOwnerId();
  const d = loadData();
  if (d.ownerId && d.envOwner === env) return d.ownerId;
  return env || null;
}
function setOwner(client, id) {
  saveData({ ownerId: id, envOwner: envOwnerId() });
  scheduleRefresh(client, 500);
}

// ---------- Penyimpanan ID pesan panel ----------
function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (_) {
    return {};
  }
}
function saveData(patch) {
  try {
    const data = { ...loadData(), ...patch };
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('⚠️  Gagal menyimpan data panel:', err.message);
  }
}

// ---------- Helper ----------
async function getVoiceChannel(client) {
  const guild = await client.guilds.fetch(cfg.guildId);
  const channel = await guild.channels.fetch(cfg.voiceChannelId);
  return channel;
}

function isLocked(channel) {
  const ow = channel.permissionOverwrites.cache.get(channel.guild.roles.everyone.id);
  return !!ow && ow.deny.has(PermissionFlagsBits.Connect);
}

function isStaff(member) {
  return (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageChannels)
  );
}

// ---------- Tampilan panel ----------
async function buildPanel(channel) {
  const locked = isLocked(channel);
  const ownerId = getOwnerId();
  const owner = ownerId ? await channel.client.users.fetch(ownerId).catch(() => null) : null;
  const code = (v) => `\`${String(v).replace(/`/g, "'")}\``;

  const embed = new EmbedBuilder()
    .setColor(locked ? 0xed4245 : 0x57f287)
    .setTitle('🎛️ Voice Control Panel')
    .setDescription(
      `Kelola voice <#${channel.id}> lewat tombol di bawah.\n` +
        '_Hanya owner 👑 dan staff yang bisa memakai panel ini._',
    )
    .addFields(
      { name: '📛 Nama', value: code(channel.name), inline: true },
      { name: '👑 Owner', value: code(owner ? owner.username : ownerId || '-'), inline: true },
      { name: '🔐 Status', value: code(locked ? 'Terkunci' : 'Terbuka'), inline: true },
    );

  const btn = (id, label, emoji, style, disabled = false) =>
    new ButtonBuilder().setCustomId(id).setLabel(label).setEmoji(emoji).setStyle(style).setDisabled(disabled);

  // 2 baris x 3 tombol: pengaturan di atas, akses di bawah
  const row1 = new ActionRowBuilder().addComponents(
    btn('vp:rename', 'Rename', '✏️', ButtonStyle.Primary),
    btn('vp:status', 'Status', '💬', ButtonStyle.Primary),
    btn('vp:users', 'Manage', '👥', ButtonStyle.Primary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    btn('vp:lock', 'Lock', '🔒', ButtonStyle.Danger, locked),
    btn('vp:unlock', 'Unlock', '🔓', ButtonStyle.Success, !locked),
    btn('vp:transfer', 'Transfer', '👑', ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row1, row2] };
}

function buildTransferMenu() {
  return {
    content:
      '**👑 Transfer**\nPilih member yang akan jadi owner baru. ' +
      '**Owner lama tidak bisa memakai panel lagi** (kecuali staff).',
    components: [
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId('vp:sel:transfer')
          .setPlaceholder('Pilih owner baru')
          .setMinValues(1)
          .setMaxValues(1),
      ),
    ],
    flags: MessageFlags.Ephemeral,
  };
}

async function handleTransfer(interaction) {
  const targetId = interaction.values[0];
  const user = interaction.users.get(targetId);

  if (user?.bot) {
    return interaction.reply({ content: '❌ Bot tidak bisa jadi owner.', flags: MessageFlags.Ephemeral });
  }
  if (targetId === getOwnerId()) {
    return interaction.reply({ content: `ℹ️ <@${targetId}> sudah jadi owner.`, flags: MessageFlags.Ephemeral });
  }

  setOwner(interaction.client, targetId);
  console.log(`👑 ${interaction.user.tag} transfer owner panel ke ${user?.tag || targetId}`);
  return interaction.reply({ content: `👑 Owner panel sekarang <@${targetId}>.`, flags: MessageFlags.Ephemeral });
}

function buildUsersMenu() {
  const permit = new UserSelectMenuBuilder()
    .setCustomId('vp:sel:permit')
    .setPlaceholder('✅ Izinkan masuk (walau voice dikunci)')
    .setMinValues(1)
    .setMaxValues(10);
  const block = new UserSelectMenuBuilder()
    .setCustomId('vp:sel:block')
    .setPlaceholder('⛔ Blokir & keluarkan dari voice')
    .setMinValues(1)
    .setMaxValues(10);
  const reset = new UserSelectMenuBuilder()
    .setCustomId('vp:sel:reset')
    .setPlaceholder('♻️ Hapus izin / buka blokir')
    .setMinValues(1)
    .setMaxValues(10);

  return {
    content:
      '**👥 Manage**\n' +
      '• **Izinkan** — user tetap bisa masuk walau voice dikunci.\n' +
      '• **Blokir** — user tidak bisa masuk & langsung dikeluarkan kalau sedang di voice.\n' +
      '• **Hapus** — kembalikan user ke pengaturan normal.',
    components: [
      new ActionRowBuilder().addComponents(permit),
      new ActionRowBuilder().addComponents(block),
      new ActionRowBuilder().addComponents(reset),
    ],
    flags: MessageFlags.Ephemeral,
  };
}

// ---------- Kirim / perbarui pesan panel ----------
async function refreshPanel(client) {
  const data = loadData();
  if (!data.channelId || !data.messageId) return;
  try {
    const voice = await getVoiceChannel(client);
    const panelChannel = await client.channels.fetch(data.channelId);
    const msg = await panelChannel.messages.fetch(data.messageId);
    await msg.edit(await buildPanel(voice));
  } catch (err) {
    console.warn('⚠️  Tidak bisa memperbarui panel:', err.message);
  }
}

function scheduleRefresh(client, delay = 3000) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refreshPanel(client), delay);
}

async function sendPanel(client, targetChannel) {
  const voice = await getVoiceChannel(client);
  const old = loadData();

  // Hapus panel lama supaya tidak dobel
  if (old.channelId && old.messageId) {
    try {
      const oldCh = await client.channels.fetch(old.channelId);
      const oldMsg = await oldCh.messages.fetch(old.messageId);
      await oldMsg.delete();
    } catch (_) {}
  }

  const msg = await targetChannel.send(await buildPanel(voice));
  saveData({ channelId: targetChannel.id, messageId: msg.id });
  return msg;
}

// Saat bot start: pakai panel yang sudah ada, atau kirim baru
// ---------- Sticky: panel selalu jadi pesan paling bawah ----------
const STICKY_DELAY_MS = 3000; // tunggu chat "tenang" 3 detik sebelum kirim ulang
let stickyTimer = null;
let stickyBusy = false;

function scheduleSticky(client) {
  clearTimeout(stickyTimer);
  stickyTimer = setTimeout(() => repostSticky(client), STICKY_DELAY_MS);
}

async function repostSticky(client) {
  if (stickyBusy) return scheduleSticky(client);
  stickyBusy = true;
  try {
    const data = loadData();
    if (!data.channelId) return;
    const ch = await client.channels.fetch(data.channelId);
    const last = (await ch.messages.fetch({ limit: 1 })).first();
    if (last && last.id === data.messageId) return; // sudah paling bawah
    await sendPanel(client, ch); // hapus panel lama + kirim baru di bawah
  } catch (err) {
    console.warn('⚠️  Gagal sticky panel:', err.message);
  } finally {
    stickyBusy = false;
  }
}

async function ensurePanel(client) {
  const data = loadData();
  const targetId = cfg.panelChannelId;

  if (data.channelId === targetId && data.messageId) {
    try {
      const ch = await client.channels.fetch(data.channelId);
      await ch.messages.fetch(data.messageId);
      await refreshPanel(client);
      console.log('🎛️  Panel voice sudah ada, diperbarui.');
      await repostSticky(client); // pastikan panel tetap pesan paling bawah
      return;
    } catch (_) {
      // pesan sudah dihapus -> kirim ulang
    }
  }

  try {
    const target = await client.channels.fetch(targetId);
    if (!target || !target.isTextBased()) {
      console.warn('⚠️  PANEL_CHANNEL_ID bukan channel teks, panel tidak dikirim.');
      return;
    }
    await sendPanel(client, target);
    console.log(`🎛️  Panel voice dikirim ke #${target.name}`);
  } catch (err) {
    console.error('⚠️  Gagal mengirim panel:', err.message);
  }
}

// ---------- Cek hak akses pemakai panel ----------
function checkAccess(interaction) {
  // Staff server (Administrator / Manage Channels) selalu bisa memakai panel
  if (interaction.member && isStaff(interaction.member)) return null;

  const owner = getOwnerId();
  if (owner && interaction.user.id === owner) return null;
  if (!owner) return '❌ Owner panel belum diatur. Isi `PANEL_OWNER_ID` di file .env bot.';
  return `❌ Hanya owner (<@${owner}>) atau staff yang bisa memakai panel ini.`;
}

function reasonOf(interaction, action) {
  return `Voice Panel: ${action} oleh ${interaction.user.tag} (${interaction.user.id})`;
}

// ---------- Aksi ----------
async function handleRename(interaction) {
  const now = Date.now();
  while (renameHistory.length && now - renameHistory[0] > RENAME_WINDOW_MS) renameHistory.shift();
  if (renameHistory.length >= RENAME_LIMIT) {
    const waitMs = RENAME_WINDOW_MS - (now - renameHistory[0]);
    const unlockAt = Math.floor((now + waitMs) / 1000);
    return interaction.reply({
      content: `⏳ Discord hanya mengizinkan ganti nama channel **2x per 10 menit**. Coba lagi <t:${unlockAt}:R>.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const voice = await getVoiceChannel(interaction.client);
  const modal = new ModalBuilder().setCustomId('vp:modal:rename').setTitle('Rename Voice Channel');
  const input = new TextInputBuilder()
    .setCustomId('name')
    .setLabel('Nama baru')
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(100)
    .setValue(voice.name.slice(0, 100))
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
}

async function handleRenameSubmit(interaction) {
  const newName = interaction.fields.getTextInputValue('name').trim();
  if (!newName) {
    return interaction.reply({ content: '❌ Nama tidak boleh kosong.', flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const voice = await getVoiceChannel(interaction.client);
  const oldName = voice.name;

  try {
    await voice.setName(newName, reasonOf(interaction, 'rename'));
    renameHistory.push(Date.now());
    console.log(`✏️  ${interaction.user.tag} rename voice: "${oldName}" -> "${newName}"`);
    await interaction.editReply(`✅ Nama voice diubah: **${oldName}** → **${voice.name}**`);
    scheduleRefresh(interaction.client, 500);
  } catch (err) {
    if (typeof err.timeToReset === 'number' || String(err.name).startsWith('RateLimitError')) {
      const unlockAt = Math.floor((Date.now() + (err.timeToReset || RENAME_WINDOW_MS)) / 1000);
      return interaction.editReply(`⏳ Kena batas rename dari Discord. Coba lagi <t:${unlockAt}:R>.`);
    }
    console.error('Rename gagal:', err);
    return interaction.editReply(`❌ Gagal rename: ${err.message}`);
  }
}

// ---------- Status voice (teks kecil di bawah nama voice) ----------
// Endpoint: PUT /channels/{id}/voice-status. Bot harus sedang berada di voice tsb.
async function handleStatus(interaction) {
  const current = loadData().voiceStatus || '';
  const modal = new ModalBuilder().setCustomId('vp:modal:status').setTitle('Status Voice');
  const input = new TextInputBuilder()
    .setCustomId('status')
    .setLabel('Status baru (kosongkan untuk menghapus)')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(500)
    .setRequired(false);
  if (current) input.setValue(current.slice(0, 500));
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
}

async function handleStatusSubmit(interaction) {
  const status = interaction.fields.getTextInputValue('status').trim();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await interaction.client.rest.put(`/channels/${cfg.voiceChannelId}/voice-status`, {
      body: { status },
      reason: reasonOf(interaction, 'ubah status'),
    });
    saveData({ voiceStatus: status });
    console.log(`💬 ${interaction.user.tag} ubah status voice: "${status}"`);
    await interaction.editReply(status ? `✅ Status voice diubah: \`${status}\`` : '✅ Status voice dihapus.');
  } catch (err) {
    console.error('Ubah status gagal:', err);
    await interaction.editReply(`❌ Gagal ubah status: ${err.message}`);
  }
}

async function handleLock(interaction, lock) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const voice = await getVoiceChannel(interaction.client);
  const everyone = voice.guild.roles.everyone;

  if (lock) {
    // Member yang sedang di dalam voice tetap bisa masuk lagi setelah dikunci
    for (const [, m] of voice.members) {
      if (m.user.bot) continue;
      const ow = voice.permissionOverwrites.cache.get(m.id);
      if (ow?.deny.has(PermissionFlagsBits.Connect)) continue;
      await voice.permissionOverwrites
        .edit(m.id, { Connect: true }, { reason: reasonOf(interaction, 'lock (izinkan member di dalam)') })
        .catch(() => {});
    }
    await voice.permissionOverwrites.edit(everyone, { Connect: false }, { reason: reasonOf(interaction, 'lock') });
    console.log(`🔒 ${interaction.user.tag} mengunci voice`);
    await interaction.editReply(
      '🔒 Voice **dikunci**. Member yang sedang di dalam otomatis diizinkan; gunakan **Manage** untuk mengizinkan orang lain.',
    );
  } else {
    await voice.permissionOverwrites.edit(everyone, { Connect: null }, { reason: reasonOf(interaction, 'unlock') });
    console.log(`🔓 ${interaction.user.tag} membuka voice`);
    await interaction.editReply('🔓 Voice **dibuka**. Semua member bisa masuk lagi (kecuali yang diblokir).');
  }
  scheduleRefresh(interaction.client, 500);
}

async function handleUserSelect(interaction, action) {
  await interaction.deferUpdate();
  const voice = await getVoiceChannel(interaction.client);
  const guild = voice.guild;
  const results = [];

  for (const userId of interaction.values) {
    const user = interaction.users.get(userId);
    const tag = user ? `<@${userId}>` : userId;

    let member = interaction.members?.get(userId);
    if (!member || !member.permissions) member = await guild.members.fetch(userId).catch(() => null);

    if (action === 'block') {
      if (userId === interaction.user.id) {
        results.push(`⚠️ ${tag}: tidak bisa memblokir diri sendiri`);
        continue;
      }
      if (user?.bot) {
        results.push(`⚠️ ${tag}: bot tidak bisa diblokir`);
        continue;
      }
      if (member && isStaff(member)) {
        results.push(`⚠️ ${tag}: admin/moderator tidak bisa diblokir`);
        continue;
      }
    }

    try {
      if (action === 'permit') {
        await voice.permissionOverwrites.edit(userId, { Connect: true }, { reason: reasonOf(interaction, 'permit') });
        results.push(`✅ ${tag} diizinkan masuk`);
      } else if (action === 'block') {
        await voice.permissionOverwrites.edit(userId, { Connect: false }, { reason: reasonOf(interaction, 'block') });
        if (member?.voice?.channelId === voice.id) {
          await member.voice.disconnect(reasonOf(interaction, 'block')).catch(() => {});
          results.push(`⛔ ${tag} diblokir & dikeluarkan`);
        } else {
          results.push(`⛔ ${tag} diblokir`);
        }
      } else if (action === 'reset') {
        if (voice.permissionOverwrites.cache.has(userId)) {
          await voice.permissionOverwrites.delete(userId, reasonOf(interaction, 'reset'));
          results.push(`♻️ ${tag} dikembalikan ke normal`);
        } else {
          results.push(`ℹ️ ${tag} tidak punya izin/blokir khusus`);
        }
      }
    } catch (err) {
      results.push(`❌ ${tag}: ${err.message}`);
    }
  }

  console.log(`👥 ${interaction.user.tag} manage users [${action}]: ${interaction.values.join(', ')}`);
  await interaction.followUp({ content: results.join('\n'), flags: MessageFlags.Ephemeral });
  scheduleRefresh(interaction.client, 500);
}

// ---------- Router interaction ----------
async function onInteraction(interaction) {
  try {
    // Slash command /voicepanel (owner / admin server) -> kirim panel ke channel ini
    if (interaction.isChatInputCommand() && interaction.commandName === 'voicepanel') {
      if (interaction.user.id !== getOwnerId() && !isStaff(interaction.member)) {
        return interaction.reply({ content: '❌ Hanya owner yang bisa mengirim panel.', flags: MessageFlags.Ephemeral });
      }
      if (!interaction.channel?.isTextBased()) {
        return interaction.reply({ content: '❌ Jalankan di channel teks.', flags: MessageFlags.Ephemeral });
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await sendPanel(interaction.client, interaction.channel);
      return interaction.editReply('✅ Panel voice dikirim di channel ini.');
    }

    const id = interaction.customId;
    if (!id || !id.startsWith('vp:')) return;
    if (interaction.guildId !== cfg.guildId) return;

    const denied = checkAccess(interaction);
    if (denied) return interaction.reply({ content: denied, flags: MessageFlags.Ephemeral });

    if (interaction.isButton()) {
      if (id === 'vp:rename') return handleRename(interaction);
      if (id === 'vp:status') return handleStatus(interaction);
      if (id === 'vp:users') return interaction.reply(buildUsersMenu());
      if (id === 'vp:lock') return handleLock(interaction, true);
      if (id === 'vp:unlock') return handleLock(interaction, false);
      if (id === 'vp:transfer') return interaction.reply(buildTransferMenu());
    }
    if (interaction.isModalSubmit() && id === 'vp:modal:rename') return handleRenameSubmit(interaction);
    if (interaction.isModalSubmit() && id === 'vp:modal:status') return handleStatusSubmit(interaction);
    if (interaction.isUserSelectMenu()) {
      if (id === 'vp:sel:permit') return handleUserSelect(interaction, 'permit');
      if (id === 'vp:sel:block') return handleUserSelect(interaction, 'block');
      if (id === 'vp:sel:reset') return handleUserSelect(interaction, 'reset');
      if (id === 'vp:sel:transfer') return handleTransfer(interaction);
    }
  } catch (err) {
    console.error('⚠️  Error di voice panel:', err);
    const payload = { content: `❌ Terjadi error: ${err.message}`, flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) interaction.followUp(payload).catch(() => {});
    else interaction.reply(payload).catch(() => {});
  }
}

// ---------- Setup ----------
function setupPanel(client, options) {
  cfg = options;

  client.on('interactionCreate', onInteraction);

  // Update jumlah member di panel saat ada yang join/leave voice
  client.on('voiceStateUpdate', (oldState, newState) => {
    if (oldState.channelId === newState.channelId) return;
    if (oldState.channelId === cfg.voiceChannelId || newState.channelId === cfg.voiceChannelId) {
      scheduleRefresh(client, 5000);
    }
  });

  // Sticky: ada pesan baru di channel panel -> panel dikirim ulang ke bawah
  client.on('messageCreate', (msg) => {
    if (msg.author.id === client.user.id) return;
    if (msg.channelId !== loadData().channelId) return;
    scheduleSticky(client);
  });

  // Simpan status voice terbaru (termasuk kalau diubah manual dari Discord)
  client.on('raw', (packet) => {
    if (packet.t === 'VOICE_CHANNEL_STATUS_UPDATE' && packet.d?.id === cfg.voiceChannelId) {
      saveData({ voiceStatus: packet.d.status || '' });
    }
  });

  // Update panel kalau admin mengubah channel langsung dari Discord
  client.on('channelUpdate', (_, newCh) => {
    if (newCh.id === cfg.voiceChannelId) scheduleRefresh(client, 3000);
  });

  client.once('ready', async () => {
    try {
      const guild = await client.guilds.fetch(cfg.guildId);
      await guild.commands.set([
        new SlashCommandBuilder()
          .setName('voicepanel')
          .setDescription('Kirim panel kontrol voice lofi radio ke channel ini')
          .setDMPermission(false)
          .toJSON(),
      ]);
      console.log('⚙️  Slash command /voicepanel terdaftar.');
    } catch (err) {
      console.error('⚠️  Gagal mendaftarkan slash command:', err.message);
    }
    if (!getOwnerId()) console.warn('⚠️  PANEL_OWNER_ID belum diisi di .env — panel tidak bisa dipakai siapa pun.');
    await ensurePanel(client);
  });
}

module.exports = { setupPanel };
