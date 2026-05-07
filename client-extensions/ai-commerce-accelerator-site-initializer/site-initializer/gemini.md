# Liferay Site Initializer Standards

This document outlines the mandatory directory structure and JSON configurations required for a Liferay Site Initializer to function correctly, specifically focusing on Master Pages, Layouts, and Fragments.

## Directory Structure

A site initializer must follow a strict folder hierarchy to be correctly parsed by Liferay:

```text
site-initializer/
├── site-initializer.json           # Site metadata
├── layout-page-templates/
│   └── master-pages/
│       └── [template-name]/
│           ├── master-page.json    # Master page metadata (MUST have ERC)
│           └── page-definition.json
├── layouts/
│   └── [order]_[page-name]/
│       ├── page.json               # Page metadata and Master Page reference
│       └── page-definition.json    # Page content and Fragment references
└── fragments/
    └── group/
        └── [collection-name]/
            ├── collection.json
            └── fragments/           # MANDATORY NESTING
                └── [fragment-name]/
                    ├── fragment.json
                    ├── fragment.html
                    ├── fragment.js
                    └── fragment.css
```

## Mandatory Requirements

### 1. Master Page Referencing

To link a Page Layout to a Master Page, the Master Page **must** define an `externalReferenceCode`.

- **In `master-page.json`**:

  ```json
  {
    "externalReferenceCode": "my-master-page",
    "name": "My Master Page"
  }
  ```

- **In `page.json`**:

  ```json
  {
    "masterPageExternalReferenceCode": "my-master-page",
    ...
  }
  ```

### 2. Fragment Nesting

Fragments within a collection folder **must** be placed inside a nested `fragments/` directory. If the collection folder is `ai-commerce-accelerator-fragments`, the actual fragments go into `ai-commerce-accelerator-fragments/fragments/[fragment-name]/`.

### 3. Case Sensitivity & Type Mapping

Liferay's initialization engine is case-sensitive for certain entity types in JSON definitions:

- **Page Type**: Use `"type": "Content"` (Capitalized).
- **Element Type**: Use `"type": "Fragment"` (Capitalized) or `"type": "Section"`.

### 4. Scoping Fragments to the Site

When a page definition references a fragment defined within the same site initializer, it should use the group key variable to ensure correct scoping:

```json
{
  "definition": {
    "fragment": {
      "key": "my-fragment-key",
      "siteKey": "[$GROUP_KEY$]"
    }
  },
  "type": "Fragment"
}
```

## Special Variables

- `[$GROUP_KEY$]`: Resolves to the site being initialized.
- `[$FRAGMENT_CLASS$]`: Injected into fragment CSS/HTML to ensure unique styling encapsulation.
