# Tests

Run `npm test` to build the package and run the tests using Node's built-in test runner. No additional dependencies are required.

## Google Test Adaptations

`google.test.js` adapts selected cases from [Google's robots.txt tests](https://github.com/google/robotstxt/blob/master/robots_test.cc), retrieved September 24, 2026.

Copyright 2019 Google LLC

The adapted file is licensed under the Apache License, Version 2.0. See [LICENSE.google](LICENSE.google). The rest of this project's original code remains under its MIT license.

Modifications: converted selected C++ GoogleTest cases into JavaScript using Node's test runner and this package's public API. Cases are grouped into tables and parser metadata assertions replace Google's reporting callbacks. This is a selected adaptation, not a complete copy of Google's suite or proof of RFC conformance.

Included coverage: group merging, unknown records, directive casing, fallback groups, path casing, longest matching rules, ties, wildcards, end anchors, query strings, comments, line endings, and UTF-8 BOM handling.

Excluded Google-specific behavior includes missing-colon recovery, user agent values containing spaces, index.html directory equivalence, Google's per-line size limit, partial byte-order marks, sitemap reporting, and internal C++ helper behavior. Encoding expectations that assume the caller already normalized the URL are covered separately by our own URL normalization tests.

`behavior.test.js` covers this package's fetching, caching, invalidation, validation, normalization, processing limit, and crawl-delay extension. Network behavior is simulated locally without external requests.
