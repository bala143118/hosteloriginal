# Contributing to HostelFix

Thank you for your interest in contributing to **HostelFix**! We welcome contributions from developers of all skill levels.

---

## 🛠️ Development Setup

1. **Fork and Clone the Repository**:
   ```bash
   git clone https://github.com/bala143118/hostel01.git
   cd hostel01
   ```

2. **Install Node Dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

4. **Run the Development Server**:
   ```bash
   npm start
   ```

5. **Run the Automated Test Suite**:
   ```bash
   npm test
   ```

---

## 📋 Guidelines

- **Code Style**: Follow clean, modular JavaScript and HTML standards.
- **Commit Messages**: Write descriptive commit messages using Conventional Commits (e.g. `feat: add room filter`, `fix: token expiration verification`).
- **Pull Requests**: Ensure all automated tests pass (`npm test`) before submitting PRs.
