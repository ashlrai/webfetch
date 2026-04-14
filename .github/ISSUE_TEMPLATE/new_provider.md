---
name: New provider request
about: Propose adding a new image source to the federation
title: "[provider] "
labels: ["provider-request"]
---

## Provider

Name, URL, one-line description.

## Use case

What kind of images does this source offer that existing providers don't?
(e.g., "historical archival", "scientific imagery", "editorial news photography")

## API availability

- Official API? Link:
- Auth required? (none / free key / paid key):
- Rate limits:
- Cost (if any) at 1K / 10K / 100K calls:
- Terms of Service link:

## License tagging

How will each returned image carry a license tag?
- Provider returns structured license metadata → map directly
- Provider tags per-item with a URL we can coerce via `license.ts`
- All items share a single license (e.g., all CC0) → hardcode default

## Sample call

```bash
curl 'https://api.example.com/search?q=test' -H 'Authorization: ...'
```

## Sample response

```json
{ ... trimmed ... }
```

## Legal / ToS notes

Any constraints on commercial reuse, attribution requirements, or rate caps.
