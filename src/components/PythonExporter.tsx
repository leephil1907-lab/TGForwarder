import React, { useState } from 'react';
import { Terminal, Copy, Check, Download, FileCode, Server, Shield, ExternalLink, Sliders } from 'lucide-react';
import { SafeConfig, ForwardingRule } from '../types';

interface PythonExporterProps {
  config: SafeConfig | null;
  rules: ForwardingRule[];
}

export const PythonExporter: React.FC<PythonExporterProps> = ({ config, rules }) => {
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [activeScriptTab, setActiveScriptTab] = useState<'copier' | 'config' | 'requirements'>('copier');

  const primaryAcc = config?.accounts?.[0];
  const sourceChannels = Array.from(new Set(rules.map((r) => r.sourceId).filter(Boolean)));
  const destChannels = Array.from(new Set(rules.flatMap((r) => r.targetIds).filter(Boolean)));
  const includeKws = Array.from(new Set(rules.flatMap((r) => r.includeKeywords || [])));
  const excludeKws = Array.from(new Set(rules.flatMap((r) => r.excludeKeywords || [])));

  const configPy = `"""
Telegram Copier Configuration - TGForwarder Pro Auto-Generated
Keep this file secure. Never commit API credentials to version control.
"""

# Telegram API Credentials (from https://my.telegram.org)
API_ID = ${primaryAcc?.apiId || 12345678}
API_HASH = "${primaryAcc?.apiHash || 'your_api_hash_here'}"

# Channel Configuration (IDs or @usernames)
SOURCE_CHANNELS = ${JSON.stringify(sourceChannels.length ? sourceChannels : ['source_channel_1', 'source_channel_2'], null, 4)}

DESTINATION_CHANNELS = ${JSON.stringify(destChannels.length ? destChannels : ['destination_channel'], null, 4)}

# Filtering Options
USE_KEYWORD_FILTER = ${includeKws.length > 0 || excludeKws.length > 0}
INCLUDE_KEYWORDS = ${JSON.stringify(includeKws)}
EXCLUDE_KEYWORDS = ${JSON.stringify(excludeKws)}

# Copy Settings
COPY_MEDIA = True
COPY_TEXT = True
PRESERVE_FORMATTING = True
SKIP_DUPLICATES = True
REMOVE_FORWARD_SIGNATURE = True

# Rate Limiting & Reliability
MIN_DELAY_SECONDS = ${(Number(config?.globalRateLimit?.minDelayMs || 1200) / 1000).toFixed(1)}
MAX_MESSAGES_PER_MINUTE = ${config?.globalRateLimit?.maxMessagesPerMinute || 25}
AUTO_SLEEP_ON_FLOODWAIT = ${config?.globalRateLimit?.autoSleepOnFloodWait ? 'True' : 'True'}
MAX_RETRIES = ${config?.globalRateLimit?.retryAttempts || 3}

# Advanced Settings
LOG_LEVEL = "INFO"
SESSION_NAME = "telegram_copier"
MAX_MESSAGE_HISTORY = 5000
`;

  const copierPy = `"""
Telegram Message Copier - Professional Edition
Production-ready message forwarding system for Termux, VPS & Linux Daemons
"""

import asyncio
import logging
import time
from datetime import datetime
from telethon import TelegramClient, events
from telethon.errors import FloodWaitError, ChannelPrivateError, ChatWriteForbiddenError
from telethon.tl.types import Message

from config import (
    API_ID, API_HASH, SOURCE_CHANNELS, DESTINATION_CHANNELS,
    USE_KEYWORD_FILTER, INCLUDE_KEYWORDS, EXCLUDE_KEYWORDS,
    COPY_MEDIA, COPY_TEXT, PRESERVE_FORMATTING, SKIP_DUPLICATES,
    REMOVE_FORWARD_SIGNATURE, MIN_DELAY_SECONDS, MAX_MESSAGES_PER_MINUTE,
    LOG_LEVEL, SESSION_NAME, MAX_MESSAGE_HISTORY,
)

# ANSI Color Codes
class Colors:
    HEADER = "\\033[95m"
    BLUE = "\\033[94m"
    CYAN = "\\033[96m"
    GREEN = "\\033[92m"
    YELLOW = "\\033[93m"
    RED = "\\033[91m"
    BOLD = "\\033[1m"
    RESET = "\\033[0m"

# Logging Setup
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL.upper()),
    format=f"{Colors.CYAN}[%(asctime)s]{Colors.RESET} %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
    handlers=[logging.FileHandler("copier.log"), logging.StreamHandler()]
)

logger = logging.getLogger(__name__)


class TelegramCopier:
    """Professional Telegram Message Copier with Multi-Channel Rate Limiting"""

    def __init__(self):
        self.client = TelegramClient(SESSION_NAME, API_ID, API_HASH)
        self.is_running = True
        self.is_paused = False
        self.message_count = 0
        self.error_count = 0
        self.start_time = None
        self.processed_messages = set()
        self.last_send_time = 0
        self.sent_timestamps = []

    def print_header(self):
        """Display professional header"""
        print(f"\\n{Colors.HEADER}{'=' * 60}{Colors.RESET}")
        print(f"{Colors.HEADER}{Colors.BOLD}    TELEGRAM MESSAGE COPIER - PRO EDITION{Colors.RESET}")
        print(f"{Colors.HEADER}{'=' * 60}{Colors.RESET}\\n")

        print(f"{Colors.CYAN}Configuration:{Colors.RESET}")
        print(f"  Sources:      {', '.join([str(s) for s in SOURCE_CHANNELS])}")
        print(f"  Destinations: {', '.join([str(d) for d in DESTINATION_CHANNELS])}")
        print(f"  Media Copy:   {'✓ Enabled' if COPY_MEDIA else '✗ Disabled'}")
        print(f"  Text Copy:    {'✓ Enabled' if COPY_TEXT else '✗ Disabled'}")
        print(f"  Clean Repost: {'✓ Enabled (No Header)' if REMOVE_FORWARD_SIGNATURE else '✗ Native Forward'}")
        print(f"  Keywords:     {'✓ ' + str(len(INCLUDE_KEYWORDS)) + ' Inc, ' + str(len(EXCLUDE_KEYWORDS)) + ' Exc' if USE_KEYWORD_FILTER else '✗ Disabled'}\\n")

    def print_status(self):
        """Display operational status"""
        uptime = str(datetime.now() - self.start_time).split('.')[0] if self.start_time else "N/A"

        print(f"\\n{Colors.HEADER}{'─' * 60}{Colors.RESET}")
        print(f"{Colors.BOLD}Status:{Colors.RESET}")
        print(f"  Running:  {'✓ Yes' if not self.is_paused else '✗ Paused'}")
        print(f"  Uptime:   {uptime}")
        print(f"  Messages: {self.message_count}")
        print(f"  Errors:   {self.error_count}")
        print(f"{Colors.HEADER}{'─' * 60}{Colors.RESET}\\n")

    def should_copy(self, text: str) -> bool:
        """Apply keyword filters"""
        if not USE_KEYWORD_FILTER:
            return True
        if not text:
            return True if COPY_MEDIA else False
        text_lower = text.lower()
        if EXCLUDE_KEYWORDS and any(k.lower() in text_lower for k in EXCLUDE_KEYWORDS):
            return False
        if INCLUDE_KEYWORDS:
            return any(k.lower() in text_lower for k in INCLUDE_KEYWORDS)
        return True

    async def enforce_rate_limit(self):
        """Enforce rate limits to respect Telegram API policies"""
        now = time.time()
        elapsed = now - self.last_send_time
        if elapsed < MIN_DELAY_SECONDS:
            await asyncio.sleep(MIN_DELAY_SECONDS - elapsed)

        # Windowed minute limit
        self.sent_timestamps = [t for t in self.sent_timestamps if t > time.time() - 60]
        if len(self.sent_timestamps) >= MAX_MESSAGES_PER_MINUTE:
            wait_sec = max(1.0, 60.0 - (time.time() - self.sent_timestamps[0]))
            logger.warning(f"{Colors.YELLOW}Rate limit reached ({MAX_MESSAGES_PER_MINUTE}/min). Waiting {wait_sec:.1f}s...{Colors.RESET}")
            await asyncio.sleep(wait_sec)

        self.last_send_time = time.time()
        self.sent_timestamps.append(self.last_send_time)

    async def safe_send_message(self, destination: str, message: Message):
        """Send message with robust flood-wait handling and retries"""
        try:
            await self.enforce_rate_limit()

            if REMOVE_FORWARD_SIGNATURE:
                if message.media and COPY_MEDIA:
                    await self.client.send_file(
                        destination, message.media,
                        caption=message.raw_text if COPY_TEXT else None,
                        formatting_entities=message.entities if PRESERVE_FORMATTING else None
                    )
                elif message.raw_text and COPY_TEXT:
                    await self.client.send_message(
                        destination, message.raw_text,
                        formatting_entities=message.entities if PRESERVE_FORMATTING else None
                    )
            else:
                await self.client.forward_messages(
                    destination,
                    messages=message.id,
                    from_peer=message.chat_id
                )
            return True
        except FloodWaitError as e:
            logger.warning(f"{Colors.YELLOW}Telegram FloodWait: auto-sleeping for {e.seconds}s...{Colors.RESET}")
            await asyncio.sleep(e.seconds + 1)
            return await self.safe_send_message(destination, message)
        except (ChannelPrivateError, ChatWriteForbiddenError) as e:
            logger.error(f"{Colors.RED}Access Forbidden for {destination}: {e}{Colors.RESET}")
            self.error_count += 1
            return False
        except Exception as e:
            logger.error(f"{Colors.RED}Send failed for {destination}: {e}{Colors.RESET}")
            self.error_count += 1
            return False

    async def setup_handlers(self):
        """Register Telegram Event Handlers"""
        resolved_sources = []
        for src in SOURCE_CHANNELS:
            try:
                entity = await self.client.get_entity(src)
                resolved_sources.append(entity)
            except Exception as e:
                logger.warning(f"Could not resolve source channel {src}: {e}")

        chats_to_watch = resolved_sources if resolved_sources else None

        @self.client.on(events.NewMessage(chats=chats_to_watch))
        async def on_new_message(event):
            if not self.is_running or self.is_paused:
                return

            message = event.message
            if SKIP_DUPLICATES and message.id in self.processed_messages:
                return

            text = message.raw_text or ""
            if not self.should_copy(text):
                logger.info(f"{Colors.YELLOW}Post #{message.id} skipped by keyword filter.{Colors.RESET}")
                return

            logger.info(f"{Colors.GREEN}New post #{message.id} detected in source. Relaying...{Colors.RESET}")

            for dest in DESTINATION_CHANNELS:
                if await self.safe_send_message(dest, message):
                    self.message_count += 1
                    logger.info(f"{Colors.GREEN}✓ Relayed to {dest}{Colors.RESET}")

            if SKIP_DUPLICATES:
                self.processed_messages.add(message.id)
                if len(self.processed_messages) > MAX_MESSAGE_HISTORY:
                    self.processed_messages.clear()

    async def control_commands(self):
        """Interactive control loop (p=pause, s=status, q=quit)"""
        while self.is_running:
            await asyncio.sleep(0.5)
            if self.is_paused:
                continue
            try:
                cmd = await asyncio.get_event_loop().run_in_executor(
                    None, lambda: input(f"{Colors.YELLOW}[p=pause, s=status, q=quit]: {Colors.RESET}").strip().lower()
                )
                if cmd == 'p':
                    self.is_paused = not self.is_paused
                    logger.info(f"{Colors.CYAN}Copier {'PAUSED' if self.is_paused else 'RESUMED'}{Colors.RESET}")
                elif cmd == 's':
                    self.print_status()
                elif cmd == 'q':
                    self.is_running = False
                    break
            except (EOFError, KeyboardInterrupt):
                continue

    async def main(self):
        """Main entry point"""
        self.print_header()
        print(f"{Colors.CYAN}Starting Telegram client...{Colors.RESET}\\n")

        await self.client.start()
        me = await self.client.get_me()

        print(f"\\n{Colors.GREEN}✓ Logged in: {me.first_name} (@{me.username}){Colors.RESET}\\n")
        print(f"{Colors.GREEN}{'=' * 60}{Colors.RESET}")
        print(f"{Colors.BOLD}        COPIER ACTIVE - MONITORING{Colors.RESET}")
        print(f"{Colors.GREEN}{'=' * 60}{Colors.RESET}\\n")

        self.start_time = datetime.now()
        await self.setup_handlers()

        await asyncio.gather(
            self.control_commands(),
            self.client.run_until_disconnected()
        )


if __name__ == "__main__":
    copier = TelegramCopier()
    try:
        asyncio.run(copier.main())
    except KeyboardInterrupt:
        print(f"\\n\\n{Colors.YELLOW}Stopped by user{Colors.RESET}\\n")
`;

  const requirementsTxt = `telethon>=1.34.0\ncryptg>=0.4.0\npython-dotenv>=1.0.0\n`;

  const handleCopy = (text: string, sectionId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(sectionId);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const handleDownload = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-1">
        <div className="flex items-center gap-2">
          <Server className="w-5 h-5 text-cyan-400" />
          <h1 className="text-lg font-bold text-white tracking-tight">Standalone Python Copier Exporter</h1>
        </div>
        <p className="text-xs text-slate-400">
          Sync your web dashboard rules, keyword filters, and rate limiting policies directly to a Python script package for running on Termux, a Linux VPS, or Raspberry Pi.
        </p>
      </div>

      {/* Quick Run Commands */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
        <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Quick Termux / VPS Setup Commands</h3>

        <div className="space-y-2 text-xs font-mono">
          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-300">
            <code>pip install telethon cryptg python-dotenv</code>
            <button
              onClick={() => handleCopy('pip install telethon cryptg python-dotenv', 'pip')}
              className="text-slate-400 hover:text-cyan-300 p-1"
            >
              {copiedSection === 'pip' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>

          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-300">
            <code>python3 copier.py</code>
            <button
              onClick={() => handleCopy('python3 copier.py', 'run')}
              className="text-slate-400 hover:text-cyan-300 p-1"
            >
              {copiedSection === 'run' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </div>

      {/* File Viewer Card */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          {/* File switcher tabs */}
          <div className="flex space-x-1 p-1 bg-slate-950 rounded-xl border border-slate-800 text-xs font-medium">
            {[
              { id: 'copier', label: 'copier.py' },
              { id: 'config', label: 'config.py' },
              { id: 'requirements', label: 'requirements.txt' }
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveScriptTab(t.id as any)}
                className={`px-3 py-1 rounded-lg transition-colors ${
                  activeScriptTab === t.id
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const text = activeScriptTab === 'copier' ? copierPy : activeScriptTab === 'config' ? configPy : requirementsTxt;
                handleCopy(text, activeScriptTab);
              }}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5"
            >
              {copiedSection === activeScriptTab ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>Copy</span>
            </button>
            <button
              onClick={() => {
                if (activeScriptTab === 'copier') handleDownload('copier.py', copierPy);
                else if (activeScriptTab === 'config') handleDownload('config.py', configPy);
                else handleDownload('requirements.txt', requirementsTxt);
              }}
              className="px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download File</span>
            </button>
          </div>
        </div>

        <pre className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 font-mono text-xs overflow-x-auto max-h-96 leading-relaxed">
          {activeScriptTab === 'copier' ? copierPy : activeScriptTab === 'config' ? configPy : requirementsTxt}
        </pre>
      </div>
    </div>
  );
};
