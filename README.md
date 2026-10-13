# YouTube Multiscreen Player

A simple, responsive web application that allows users to watch multiple YouTube videos simultaneously in a grid layout.

![Screenshot 2024-11-06 180450](https://github.com/user-attachments/assets/513b0103-22e5-42b8-a7e2-2852c157181c)


## Features

- Add multiple YouTube videos to a single page
- Responsive grid layout that adapts to screen size
- Support for various YouTube URL formats
- Individual video removal controls
- Clean, modern user interface
- Keyboard support (Enter to add videos)
- Auto-play enabled for added videos

## Usage

1. Launch the application using the [installation instructions](#installation) below
2. Paste a YouTube URL into the input field
3. Click "Add Video" or press Enter to add the video to the grid
4. Repeat to add more videos
5. Click the '×' button on any video to remove it from the grid

## Supported URL Formats

The player supports various YouTube URL formats, including:
- Standard watch URLs (https://www.youtube.com/watch?v=VIDEO_ID)
- Short URLs (https://youtu.be/VIDEO_ID)
- Embed URLs (https://www.youtube.com/embed/VIDEO_ID)

## Technical Details

- Pure HTML, CSS, and JavaScript implementation
- No build step or third-party application dependencies
- Responsive design using CSS Grid
- YouTube iframe embeds

## Browser Support

Works in all modern browsers that support:
- CSS Grid
- ES6 JavaScript
- YouTube iframe embeds

## Installation

Serve the application over HTTP or HTTPS. **Do not double-click `index.html` or
open it with a `file://` URL.** YouTube requires a browser-provided HTTP `Referer`
or equivalent client identification; local-file launches cannot provide a normal
HTTP origin and can cause **Error 153**.

### Local launch (Python 3)

Download or clone this repository, then open a terminal in its folder:

```sh
python3 serve.py
```

On Windows, use `py serve.py` instead. Python 3.7 or newer is required for this
optional launcher; it uses only the standard library, with nothing to install
from pip. It opens `http://127.0.0.1:8000/` in your default browser. If a browser
does not open, copy the printed address into one. Keep the terminal running while
using Multiwin; press Ctrl+C to stop it.

If port 8000 is already in use, run `python3 serve.py --port 0` to select a free
port (or `--port 8001` to choose one). Add `--no-browser` to print the address
without opening a browser. The launcher works from any working directory, binds
only to this computer's loopback interface, and serves only `index.html`.

If you downloaded only `index.html`, Python's built-in static server also works.
Run this from the folder containing that file, then visit `http://127.0.0.1:8000/`:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

This alternative serves the entire current directory, so use a dedicated folder.

### Static hosting (no Python required)

Upload `index.html` to any static HTTPS host and open its hosted URL. No backend,
API key, package installation or build is needed. For GitHub Pages, publish the
repository's root directory using your repository's Pages settings, then use the
URL GitHub provides. Do not use a GitHub `blob` or `raw` URL as the player page.
The Python launcher is for local use, not public hosting.

### Error 153 troubleshooting

- Check that the address starts with `http://` or `https://`. A local-file launch
  now shows instructions and disables video creation until opened via a server.
- The page and its video iframes explicitly use
  `strict-origin-when-cross-origin`, YouTube's recommended referrer policy. This
  lets the browser send the hosting origin without exposing the page's path or
  query string. It does not fabricate a `Referer` or fix a `file://` origin.
- If the error persists on HTTP/HTTPS, inspect the request to
  `https://www.youtube.com/embed/...` in your browser's Network tools. Its request
  headers should include `Referer: <your hosting origin>/`. Check whether browser
  privacy settings, extensions, a proxy, or hosting configuration removes it.
- If autoplay is blocked, click the player's Play button. Private, removed,
  age/region-restricted or non-embeddable videos may still fail independently.

See YouTube's [Error 153 definition](https://developers.google.com/youtube/iframe_api_reference#Events)
and [client identification requirements](https://developers.google.com/youtube/terms/required-minimum-functionality#api-client-identity-and-credentials).

## Checks

Test the local launcher using the Python standard library:

```sh
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

For browser regression checks, install the **development-only** Playwright tool
(Node.js 18+), then run:

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
node --test tests/browser.test.cjs
```

Set `PYTHON` to your Python 3 executable if it is not `python3` (for example,
`$env:PYTHON = "py"` in PowerShell). The browser checks intercept YouTube requests
to verify the real browser-generated referrer and UI behaviour without depending
on YouTube availability. **They do not prove actual YouTube playback.**

For a live playback check, launch Multiwin, add a known embeddable video and
confirm the video actually advances, then test adding a second video, resizing,
reordering, fullscreen and removal. Check the embed request's `Referer` in Network
tools. Record the browser, launch URL and any YouTube error; loading an iframe
alone is not a successful playback test.

## License

Feel free to use and modify this code for your own projects.
