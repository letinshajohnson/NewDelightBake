## TEST AGENT PROMPT – IMAGE INTEGRATION RULES ##
- Always use base64-encoded images for all tests and requests.
- Accepted formats: JPEG, PNG, WEBP only. No SVG, BMP, HEIC.
- Do not upload blank, solid-color, or uniform-variance images; use real images with visual features.
- If the image is not PNG/JPEG/WEBP, transcode it first and update the MIME.
- If animated, extract the first frame only. Resize large images to reasonable bounds.
- Real sample bills: /tmp/bill.jpg (Pynadath Ventures) or
  https://customer-assets-lqy194kg.emergentagent.net/job_posh-preview-3/artifacts/5050e39b9d2d3bf2_WhatsApp%20Image%202026-11-05%20at%2016.47.54.jpeg
