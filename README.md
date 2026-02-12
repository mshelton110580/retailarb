# ArbDesk

ArbDesk is a full-stack retail arbitrage workspace for eBay buyers. It provides targets/sniping, order sync via eBay Trading API, inventory dashboards, receiving workflows, and a returns-only scraper built on Playwright.

## Tech Stack

- Next.js (App Router) + Tailwind
- NextAuth (Credentials) with RBAC roles
- Postgres + Prisma
- BullMQ + Redis
- Playwright (returns-only scraping)
- Local filesystem storage with an abstraction for future S3/R2 support

## Server Setup (Ubuntu 22.04)

These instructions detail how to set up the ArbDesk environment from scratch on a fresh Ubuntu 22.04 server. This is the same process used to create the live development environment.

### 1. Install System Dependencies

First, update your package list and install PostgreSQL, Redis, and Node.js.

```bash
sudo apt-get update -qq
sudo apt-get install -y postgresql-14 redis-server
```

### 2. Configure PostgreSQL

Start the PostgreSQL service and create a database and user for ArbDesk.

```bash
# Start PostgreSQL
sudo pg_ctlcluster 14 main start

# Create the database and user
sudo -u postgres psql -c "CREATE DATABASE arbdesk;"
sudo -u postgres psql -c "CREATE USER postgres WITH PASSWORD 'postgres';"
sudo -u postgres psql -c "ALTER USER postgres WITH SUPERUSER;"

# Allow password authentication for local connections
sudo sed -i "s/local   all             all                                     peer/local   all             all                                     md5/g" /etc/postgresql/14/main/pg_hba.conf

# Restart PostgreSQL to apply changes
sudo systemctl restart postgresql
```

### 3. Configure Redis

Start the Redis server as a background process.

```bash
sudo redis-server --daemonize yes
```

### 4. Clone and Set Up the Application

Clone the repository and install Node.js dependencies.

```bash
# Clone the repo
git clone https://github.com/mshelton110580/retailarb.git
cd retailarb

# Install Node.js dependencies
npm install
```

### 5. Configure Environment Variables

Create a `.env` file from the example and fill in your specific details.

```bash
cp .env.example .env
```

Open `.env` in a text editor and configure the following:

| Variable | Description |
|---|---|
| `DATABASE_URL` | `postgresql://postgres:postgres@127.0.0.1:5432/arbdesk` |
| `REDIS_URL` | `redis://localhost:6379` |
| `APP_BASE_URL` | Your public app URL (e.g., `https://arbdesk.yourdomain.com`) |
| `ENCRYPTION_KEY` | Generate a 32-byte hex key: `openssl rand -hex 32` |
| `NEXTAUTH_SECRET` | Generate another 32-byte hex key: `openssl rand -hex 32` |
| `NEXTAUTH_URL` | Same as `APP_BASE_URL` |
| `EBAY_CLIENT_ID` | Your eBay app's Client ID |
| `EBAY_CLIENT_SECRET` | Your eBay app's Client Secret |
| `EBAY_DEV_ID` | Your eBay app's Developer ID |
| `EBAY_REDIRECT_URI` | Your eBay app's **RuName** (not the URL) |

### 6. Run Database Migrations and Seed

Apply the database schema and create the initial admin user.

```bash
# Generate Prisma client
npx prisma generate

# Apply migrations
npx prisma migrate deploy

# Seed the admin user
npx tsx prisma/seed.ts
```

### 7. Build and Start the Application

Build the Next.js app and start it in production mode.

```bash
# Build the app
npm run build

# Start the app (in the background)
nohup npm start &
```

### 8. Set Up Cloudflare Tunnel (Optional, Recommended)

To expose your local server to the internet, use a Cloudflare Tunnel.

1.  Install `cloudflared`:
    ```bash
    curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb
    sudo dpkg -i /tmp/cloudflared.deb
    ```
2.  Get your tunnel token from the Cloudflare Zero Trust dashboard.
3.  Start the tunnel:
    ```bash
    nohup cloudflared tunnel --no-autoupdate run --token YOUR_TUNNEL_TOKEN &
    ```

Your app should now be live at your `APP_BASE_URL`.

## Local Development (Docker)

For a simpler local setup, you can use the provided Docker configuration.

1.  Clone the repository and `cd` into it.
2.  Copy `.env.example` to `.env` and fill in your eBay credentials.
3.  Run `docker compose up --build`.
4.  In a separate terminal, run migrations: `docker compose exec app npm run prisma:migrate`.
5.  Seed the admin user: `docker compose exec app npm run seed`.
6.  Visit the app at http://localhost:3000.
