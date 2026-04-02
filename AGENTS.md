# Agent Instructions

This project uses a `.agents` directory for all AI-generated documentation files.

## Guidelines for AI Agents

**DO NOT** create AI-related markdown files in the project root directory.

**Instead**, write all AI-generated documentation, summaries, and implementation notes to the `.agents/` directory.

### Files that belong in `.agents/`:
- Implementation summaries
- Debugging notes
- Refactoring documentation
- Test documentation
- Any AI-generated markdown files

### Files that should remain in root:
- `README.md` - Project readme for human developers
- `LICENSE` - License file
- `CHANGELOG.md` - User-facing changelog (if applicable)

## Config Files

- `.env/config.json` - User-specific configuration (gitignored, contains sensitive data)
- `config.json` - Default/example configuration (gitignored)
- `config.json.example` - Example configuration template (tracked in git)