# TGForwarder — Real-Time Telegram Message Forwarder & Channel Cloner

A modern, full-stack Telegram message forwarding engine and channel replication dashboard built with React, TypeScript, Tailwind CSS, Express, and GramJS / MTProto.

## Features

- ⚡ **MTProto User & Bot Client**: Forward messages directly through your Telegram account or bot.
- 🔒 **Private Channels & Groups Support**: Relay messages from private channels and groups you have joined without requiring admin status in the source.
- 🛡️ **Restricted Content Handling**: Automatically handles "Restrict saving content" channels by streaming media and text payloads via clean direct reposts.
- 📋 **Rules & Transformation Manager**:
  - Whitelist / blacklist keyword filtering
  - Regex replacement & watermark removal
  - Media type filters (Photo, Video, Document, Audio, Voice, Poll)
  - Duplicate detection & deduplication hashes
  - Header removal ("Forwarded from" signature stripping)
- 📊 **Real-Time Live Event Stream**: Server-Sent Events (SSE) stream for monitoring forwarded messages, rates, and active pipelines.
- 🗄️ **Durable Local Mapping**: Tracks source-to-destination message IDs for full synchronization.

## Quick Start

### 1. Installation

```bash
git clone https://github.com/leephil1907-lab/TGForwarder.git
cd TGForwarder
npm install
```

### 2. Configuration

Copy `.env.example` to `.env` and fill in your credentials from [my.telegram.org](https://my.telegram.org):

```bash
cp .env.example .env
```

```env
TG_API_ID="your_api_id"
TG_API_HASH="your_api_hash"
```

### 3. Run Development Server

```bash
npm run dev
```

Open your browser at `http://localhost:3000`.

### 4. Production Build

```bash
npm run build
npm start
```

## Security & Privacy Notice

- Never commit your `.env` file, `.data/` directory, or Telegram session strings (`*.session`) to public repositories.
- All session credentials, tokens, and phone numbers are excluded in `.gitignore`.
