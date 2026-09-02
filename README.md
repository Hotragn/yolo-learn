# Agent Memory That Heals (working title, founder picks final name)

Teach your agent once. It remembers forever. When the site changes, it detects
drift, asks one question, and heals itself.

Built for the OpenAI WebMCP Challenge.

## Run it

    npm install
    npm run dev

- Flow Library: #/
- Demo site: #/site (v1) and #/site?v=2 (the one-year-later redesign)
- Teach mode: #/site?teach=1
- Live tool registry: #/tools

## Test with WebMCP

- Chrome 149+: enable chrome://flags/#enable-webmcp-testing
- ChatGPT desktop app: open the deployed URL in the in-app browser

Stack: Vite + React + TypeScript, hash routing, localStorage, no backend, MIT.
