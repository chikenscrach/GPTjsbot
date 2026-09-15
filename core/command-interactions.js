'use strict';

const { MessageFlags } = require('discord.js');

async function handleCommandInteraction(interaction) {
  if (interaction.isAutocomplete()) {
    const command = interaction.client.commands.get(interaction.commandName);
    try {
      if (command?.autocomplete) await command.autocomplete(interaction);
      else await interaction.respond([]);
    } catch (error) {
      console.error('自動完成處理失敗：', error);
      if (!interaction.responded) {
        try { await interaction.respond([]); }
        catch (err) { console.error('回覆自動完成失敗：', err); }
      }
    }
    return;
  }
  if (!interaction.isChatInputCommand() && !interaction.isMessageContextMenuCommand()) return;
  const command = interaction.client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    // 沿用既有 slash / 訊息右鍵錯誤回覆；autocomplete 使用獨立回覆流程。
    try {
      if (interaction.deferred && !interaction.replied) {
        await interaction.editReply('❌ 執行指令時發生錯誤。');
      } else if (interaction.replied) {
        await interaction.followUp({ content: '❌ 執行指令時發生錯誤。', flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: '❌ 執行指令時發生錯誤。', flags: MessageFlags.Ephemeral });
      }
    } catch (err) {
      console.error('回覆錯誤訊息失敗：', err);
    }
  }
}

module.exports = { handleCommandInteraction };
