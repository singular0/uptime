# Vendored frontend libraries

Unmodified copies of npm package builds, served by the dashboard at `/dashboard/vendor/`. Source maps are left out. To update a library, run `npm pack <name>@<version>` and copy the same file from the tarball.

| Library | Version | File(s) in the npm package | License |
| --- | --- | --- | --- |
| [jQuery](https://jquery.com/) | 4.0.0 | `jquery`: `dist/jquery.min.js` | MIT |
| [Bootstrap](https://getbootstrap.com/) | 5.3.8 | `bootstrap`: `dist/css/bootstrap.min.css` (CSS only, no Bootstrap JS) | MIT |
| [Bootstrap Icons](https://icons.getbootstrap.com/) | 1.13.2 | `bootstrap-icons`: `font/bootstrap-icons.min.css`, `font/fonts/*` | MIT |
| [Moment.js](https://momentjs.com/) | 2.31.0 | `moment`: `min/moment.min.js` | MIT |
| [EJS](https://ejs.co/) | 7.0.2 | `ejs`: `ejs.min.js` (same version as the server-side `ejs` dependency) | Apache-2.0 |
| [Chart.js](https://www.chartjs.org/) | 4.6.1 | `chart.js`: `dist/chart.umd.min.js` | MIT |
| [Tagify](https://github.com/yairEO/tagify) | 4.39.0 | `@yaireo/tagify`: `dist/tagify.js`, `dist/tagify.css` | MIT |
