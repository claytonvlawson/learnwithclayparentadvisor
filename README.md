# Parent Advisor: Vault Preview

Static front end for the LearnWithClay Parent Advisor — a retrieval-augmented
advisor for hearing parents of Deaf and hard of hearing children. Answers are
grounded in the curated vault and cite their sources; crisis questions return
resources first.

- Live: https://learnwithclayparentadvisor.netlify.app
- Backend: https://learnwithclay.ai/api/parent/chat
- Single static page: `index.html` (no build step)

## Local preview

    python3 -m http.server 8080

Then open http://localhost:8080.

## Contributing

Read the [Code of Conduct](CODE_OF_CONDUCT.md) before opening an issue or a pull
request. It is a Contributor Covenant 2.1 document with project-specific rules on
grounding answers in cited sources, Deaf-centered framing, keeping crisis handling
intact, and accessibility in how we work.

## Deploy

Netlify project `learnwithclayparentadvisor`. Publish directory is the repo root;
there is no build command. Any push to `main` can deploy once the Netlify site is
linked to this repository.
