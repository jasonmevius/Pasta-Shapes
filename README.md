# PastaShapes

PastaShapes is a lightweight, static site that helps people **look up pasta shapes by name** and **identify an unknown shape** using a simple, guided question flow.

Primary goals:
- Ship something usable quickly
- Keep the project easy to maintain (CSV-driven content, static deploy)
- Stay within a simple web stack (11ty + HTML/CSS/vanilla JS)

---

## Project overview

### 1) Search by name
- Type a pasta name and get matching results
- Supports common misspellings / alternate names (when included in the dataset)
- Links to a dedicated detail page for each shape

### 2) Identify by questions
- If you have the pasta in front of you, answer a sequence of questions (e.g., hollow, twisted, ridged)
- Each answer narrows down the candidate list until you reach the best match

---

## Tech stack

- **Eleventy (11ty)** - static site generation from CSV-backed data
- **Nunjucks (.njk)** - templating for layouts and pages
- **Vanilla JavaScript** - client-side search + Identify flow logic + local “Recently Viewed”
- **CSS (single stylesheet)** - all styling is centralized (no inline CSS)
- **Netlify + GitHub** - builds and hosting
- **ImageKit (optional)** - image hosting + transformations where helpful

---

## Data approach

- **CSV is the source of truth** for pasta shapes and attributes
- CSV changes trigger a rebuild that regenerates pages and the search index
- An `/api/...json` endpoint is generated for fast client-side lookup

---

## Status

This is an actively evolving personal project focused on learning, speed, and maintainability.
