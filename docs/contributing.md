---
layout: page
title: Contributing
---

# Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Getting Started

### Fork and Clone

1. Fork the repository
2. Clone your fork locally:

```bash
git clone https://github.com/YOUR_USERNAME/sshift.git
cd sshift
```

### Install Dependencies

```bash
npm install
```

### Create a Branch

```bash
git checkout -b feature/AmazingFeature
```

## Development Workflow

### Run Development Server

```bash
npm run dev
```

The application will be available at `http://localhost:3000`

### Run Tests

```bash
# Run all tests
npm test

# Run unit tests only (fast, no server needed)
npm run test:unit

# Run integration tests (requires running server)
npm run test:integration

# Run browser tests (requires running server)
npm run test:browser
```

### Code Style

- Follow the existing code style
- Use meaningful variable and function names
- Add comments for complex logic
- Keep functions small and focused

### Commit Messages

Use clear, descriptive commit messages:

```
feat: add custom layout support
fix: resolve SSH connection timeout issue
docs: update installation instructions
test: add unit tests for SFTP operations
refactor: simplify session management
```

## Pull Request Process

1. **Update documentation** if you change functionality
2. **Add tests** for new features
3. **Ensure all tests pass** before submitting
4. **Update the README** if needed
5. **Request review** from maintainers

### PR Checklist

- [ ] Code follows project style guidelines
- [ ] All tests pass
- [ ] New tests added for new functionality
- [ ] Documentation updated
- [ ] Commit messages are clear and descriptive
- [ ] Branch is up to date with main

## Code of Conduct

### Be Respectful

- Use welcoming and inclusive language
- Be respectful of differing viewpoints
- Accept constructive criticism gracefully
- Focus on what is best for the community

### Be Collaborative

- Help others when you can
- Share knowledge and resources
- Provide constructive feedback
- Work together to solve problems

## Questions?

- **Issues**: [GitHub Issues](https://github.com/lethevimlet/sshift/issues)
- **Discussions**: [GitHub Discussions](https://github.com/lethevimlet/sshift/discussions)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.