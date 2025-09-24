# GOV.UK Curated npm Repository

A Verdaccio plugin that quarantines npm packages, performs security scanning, and requires manual approval before allowing package downloads across GOV.UK services.

## Overview

This plugin intercepts npm package requests, automatically quarantines unknown packages, performs security risk assessment, and blocks downloads until packages receive manual approval. It provides a controlled gateway for npm dependencies used in government services.

## Features

- **Automatic Quarantine**: New package requests are automatically blocked and quarantined
- **Security Scanning**: Automated security analysis including:
  - Suspicious install scripts (preinstall, postinstall, etc.)
  - Network access patterns (fetch, axios, HTTP calls)  
  - Filesystem operations (file writes, directory traversal)
  - Binary executables and large files
  - Dependency analysis for suspicious packages
- **Risk Scoring**: Numerical risk assessment (0-100) based on scan results
- **Manual Approval Workflow**: Administrative approval required before package access
- **Audit Logging**: Complete log of blocked attempts and package requests
- **REST API**: Management interface for approvals and monitoring

## Installation

### Prerequisites

- Verdaccio npm registry server
- Node.js (Active LTS version)
- Appropriate storage permissions for quarantine directory

### Setup

1. Install the plugin in your Verdaccio installation:

```bash
npm install @govuk/verdaccio-quarantine-plugin
```

2. Add to your Verdaccio `config.yaml`:

```yaml
middlewares:
  quarantine:
    enabled: true
    quarantinePath: /path/to/quarantine/storage
    autoscan: true
    riskThreshold: 50
```

3. Restart Verdaccio

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable the plugin |
| `quarantinePath` | string | `{storage}/_quarantine` | Directory for quarantine data |
| `autoscan` | boolean | `true` | Automatically scan quarantined packages |
| `riskThreshold` | number | `50` | Risk score threshold for flagging |

## Usage

### For Developers

When you request a new npm package:

1. **First Request**: Package is automatically quarantined and blocked
2. **Notification**: You'll receive a 403 error with approval instructions
3. **Wait for Approval**: Contact administrators for package review
4. **Approved Access**: Once approved, package downloads normally

### For Administrators

#### View Package Requests
```bash
GET /-/quarantine/requests
```

#### Approve a Package  
```bash
PUT /-/quarantine/approve/@scope/package-name
```

#### View Security Scan Results
```bash
GET /-/quarantine/scan/@scope/package-name
```

#### Monitor Blocked Attempts
```bash
GET /-/quarantine/blocked
```

## API Reference

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/-/quarantine/requests` | List all package requests |
| `PUT` | `/-/quarantine/approve/{package}` | Approve a package |
| `GET` | `/-/quarantine/scan/{package}` | Get security scan results |
| `GET` | `/-/quarantine/blocked` | View blocked access attempts |

### Package States

- **`pending`**: Package requested but not yet scanned
- **`approved`**: Package cleared for download
- **`blocked`**: Package automatically quarantined (default for new packages)
- **`rejected`**: Package manually rejected by administrator

### Risk Assessment

The scanner evaluates packages across multiple dimensions:

**Security Risks Detected:**
- Suspicious install scripts that execute during installation
- Network access patterns that could indicate data exfiltration
- Filesystem operations that modify system files
- Binary executables or large files
- Dependencies with suspicious names or patterns

**Risk Severity Levels:**
- **Low (10 points)**: Minor concerns like filesystem access
- **Medium (30 points)**: Network calls, executables, suspicious dependencies  
- **High (60 points)**: Install scripts, package.json parsing errors
- **Critical (100 points)**: Scan failures, major security red flags

## Development

### Project Structure

```
src/
├── index.ts              # Main plugin entry point
├── approval-manager.ts   # Package approval and database management
├── scanner.ts           # Security scanning engine
└── middleware.ts        # Express routes and request interception
```

### Database Schema

Approval data is stored in JSON format:

```json
{
  "packages": {
    "package-name": {
      "status": "pending|approved|blocked|rejected",
      "requestedAt": "2025-01-15T10:30:00.000Z",
      "approvedAt": "2025-01-15T14:30:00.000Z",
      "riskScore": 25,
      "scanResults": { ... },
      "requestedBy": "user@example.com"
    }
  },
  "version": 1
}
```

## Security Considerations

- **Fail-Safe Design**: Unknown packages are blocked by default
- **Comprehensive Scanning**: Multiple analysis techniques for threat detection
- **Audit Trail**: All access attempts and approvals are logged
- **Isolation**: Quarantined packages are extracted safely for analysis
- **Rate Limiting**: Blocked attempts are logged and monitored

## Contributing

1. **Security Issues**: Report privately to [security@digital.cabinet-office.gov.uk](mailto:security@digital.cabinet-office.gov.uk)
2. **Bug Reports**: Use GitHub Issues for non-security bugs
3. **Feature Requests**: Discuss via GitHub Discussions
4. **Pull Requests**: Follow standard government coding practices

### Testing

```bash
# Run tests
npm test

# Run security checks  
npm audit
npm run security-scan

# Lint code
npm run lint
```

## Monitoring and Alerting

Monitor these key metrics:

- **Quarantine Queue Size**: Number of pending packages
- **High Risk Packages**: Packages with risk scores >70
- **Blocked Attempts**: Frequency of blocked access attempts
- **Approval Latency**: Time between request and approval

## Troubleshooting

### Common Issues

**Package Still Blocked After Approval**
- Verify approval was successful via API
- Check Verdaccio cache hasn't retained old status
- Restart Verdaccio if needed

**Scan Failures** 
- Check quarantine directory permissions
- Verify sufficient disk space for package extraction
- Review logs for specific error details

**High Memory Usage**
- Large packages may require significant memory for scanning
- Consider implementing scan timeouts
- Monitor extraction directory cleanup

## Support

### Internal Support
- **Slack**: #govuk-platform
- **Email**: govuk-platform@digital.cabinet-office.gov.uk

### External Contributors  
- **Issues**: GitHub Issues for bugs and feature requests
- **Discussions**: GitHub Discussions for questions

## Licence

Unless stated otherwise, the codebase is released under the [MIT License](LICENSE).

The documentation is [© Crown copyright](https://www.nationalarchives.gov.uk/information-management/re-using-public-sector-information/uk-government-licensing-framework/crown-copyright/) and available under the terms of the [Open Government 3.0 licence](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).

## Related Projects

- [Verdaccio](https://verdaccio.org/) - Private npm registry server
- [GOV.UK Frontend](https://github.com/alphagov/govuk-frontend) - GOV.UK design system
- [npm audit](https://docs.npmjs.com/cli/v8/commands/npm-audit) - npm's built-in security auditing

---

This plugin is maintained by the GOV.UK Platform team at the Government Digital Service.
