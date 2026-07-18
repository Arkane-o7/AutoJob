# Third-party notices

Scout contains code and implementation ideas adapted from the following open-source project.

## Offlyn Apply

- Project: https://github.com/offlyn-ai/offlyn-apply
- Reference revision: `6179317448bcaf8c04dbdf50905771b98d7af93a`
- Copyright: Copyright (c) 2026 Offlyn
- License: MIT License
- Local license copy: `licenses/OFFLYN_APPLY_MIT.txt`

Scout retains its existing interface and storage model. Its ATS recognition, field-classification safeguards, value-normalization behavior, controlled-input compatibility layer, local Ollama service patterns, multi-profile model, knowledge-memory patterns, and Workday inline-form handler include adaptations from Offlyn Apply. Scout removes Offlyn's automatic Workday step navigation and keeps submission manual.

## Job App Filler

- Project: https://github.com/berellevy/job_app_filler
- Reference revision: `6d6062cb98bbe70c2946d9d43b519a01b19da448`
- Copyright: Copyright © 2024-present, Dovber Levy. All rights reserved.
- License: BSD 3-Clause License
- Local license copy: `licenses/JOB_APP_FILLER_BSD_3_CLAUSE.txt`

Scout adapts Greenhouse legacy/React field-container, Select2/react-select option, and file-dropzone compatibility patterns from Job App Filler. The original extension's UI, storage, injected React-property access, and automatic behavior are not included. The adapted layer uses normal DOM events, leaves low-confidence fields empty, and never submits or advances an application.

## PDF.js

- Project: https://github.com/mozilla/pdf.js
- Version: 5.4.624
- Copyright: Mozilla Foundation
- License: Apache License 2.0
- Local license copy: `licenses/PDFJS_APACHE_2.txt`

Scout uses a self-hosted PDF.js build to extract selectable resume text locally inside the extension. Resume files and extracted text are not sent to PDF.js or any external parsing service.
