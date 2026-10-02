# Third-party notices

## AriaNg

This project is a from-scratch re-implementation of **AriaNg**
(<https://github.com/mayswind/AriaNg>), a modern web frontend for aria2,
written in TypeScript + React + Vite with Material Design 3 (mdui) and
targeting **aria2-next** (<https://github.com/AnInsomniacy/aria2-next>).

Behaviour, layout, routes, keyboard shortcuts, the command-line URL API and the
translation resources are derived from AriaNg.

AriaNg is licensed under the MIT License:

```
MIT License

Copyright (c) 2015 MaysWind

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The translated UI strings (`src/i18n/locales/*`) originate from AriaNg's
`src/langs/*.txt` and `i18n/en.sample.txt`, and remain covered by the license
above. Individual language files list their original contributors in AriaNg's
README; please keep those attributions intact when editing translations.

## aria2 / aria2-next

aria2 is licensed under GPLv2. This project contains **no** aria2 source code —
it only speaks the aria2 JSON-RPC protocol. The aria2 RPC contract and the
`aria2-next` documentation were used as the behavioural specification for the
RPC layer, the option catalogue and the media / ED2K features.

## mdui & Material Design 3

UI components come from [mdui](https://github.com/fernvenue/mdui) (MIT),
which implements Google's [Material Design 3](https://m3.material.io/)
specification. Material Icons are provided by
[@mdui/icons](https://www.npmjs.com/package/@mdui/icons). No Material Design
art assets are redistributed in this repository.
