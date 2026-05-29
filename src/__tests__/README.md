# Test Structure

This directory contains all test files for the QA Touchstone application, organized to mirror the source code structure.

## Directory Structure

```
src/__tests__/
├── App.test.jsx                    # Main App component tests
├── electron.test.jsx               # Electron main process tests
├── components/                     # Component tests
│   └── CertificatesDataGrid.test.jsx    # Certificate data grid component tests
├── contexts/                       # Context provider tests
│   ├── CertificatesContext.test.jsx     # Certificate state management tests
│   ├── FlashingContext.test.jsx         # Flashing state management tests
│   └── PostmanContext.test.jsx          # Postman collection state tests
├── pages/                         # Page component tests
│   ├── Home.test.jsx             # Home page tests
│   ├── CertificatesPage.test.jsx # Certificates management page tests
│   ├── ApiTestPage.test.jsx      # API testing page tests
│   ├── FilesPage.test.jsx        # File management page tests
│   ├── NordicFlashPage.test.jsx  # Nordic device flashing tests
│   ├── SilabsFlashPage.test.jsx  # Silabs device flashing tests
│   ├── EfdFlashPage.test.jsx     # EFD device flashing tests
│   ├── RfdFlashPage.test.jsx     # RFD device flashing tests
│   ├── Page7.test.jsx            # Additional page placeholder tests
│   └── settings/                 # Settings page tests
│       ├── EnvSettings.test.jsx          # Environment settings tests
│       ├── ApiSettings.test.jsx          # API configuration tests
│       ├── NordicPathsSettings.test.jsx  # Nordic tools paths tests
│       ├── SilabsMauiPathsSettings.test.jsx # Silabs Maui tools paths tests
│       └── Setting5.test.jsx             # Additional settings page tests
├── test-report/                   # Generated test coverage reports
└── README.md                     # This file
```

## Test Organization Principles

1. **Mirror Source Structure**: Test files follow the same directory structure as the source code
2. **Descriptive Naming**: Test files use `.test.jsx` suffix for easy identification
3. **Comprehensive Coverage**: Tests cover components, pages, contexts, and settings functionality
4. **Mock Electron API**: All tests mock the Electron API for isolated testing
5. **Performance Testing**: Integrated performance monitoring for test optimization

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Generate HTML coverage report
npm run test:report
```

## Test Features Covered

### Main App (App.test.jsx)
- Navigation functionality with modern pill-style navigation
- Window controls (minimize, maximize, close)
- Tab switching and dynamic visibility
- Configuration loading and real-time updates
- Theme and styling with dark mode
- Responsive layout and glass morphism effects

### Electron Main Process (electron.test.jsx)
- IPC communication between main and renderer processes
- File system operations and configuration management
- Command execution and process management
- Flash path data storage and retrieval
- Postman collection handling and API operations
- Serial port and network connectivity management

### Components
- **CertificatesDataGrid**: Certificate display, editing, filtering, and performance optimization

### Contexts
- **CertificatesContext**: Certificate data management, caching, and filter state persistence
- **FlashingContext**: Device flashing state and process control
- **PostmanContext**: Postman collection state and API request management

### Pages
- **Home**: Welcome screen with glass morphism design, quick links, and modern interface
- **CertificatesPage**: Certificate management with enhanced UX and real-time synchronization
- **ApiTestPage**: Postman integration, AWS SigV4 authentication, and API request execution
- **FilesPage**: Multi-device file management with serial and network connectivity
- **NordicFlashPage**: Nordic device flashing with real-time console output
- **SilabsFlashPage**: Silabs device flashing operations
- **EfdFlashPage**: EFD device-specific flashing commands
- **RfdFlashPage**: RFD device flashing with certificate validation
- **Page7**: Additional page placeholder for future functionality

### Settings
- **EnvSettings**: Environment configuration, path management, and feature flags
- **ApiSettings**: AWS configuration, Postman collection management, and credential handling
- **NordicPathsSettings**: Nordic development tool path configuration
- **SilabsMauiPathsSettings**: Silabs Maui tool path configuration
- **Setting5**: Additional settings page placeholder

## Mock Strategy

All tests use comprehensive mocks to ensure:
- **Electron API**: Complete IPC communication mocking
- **File System**: Isolated file operations without actual file access
- **Serial Ports**: Mock serial port communication for device testing
- **Network Operations**: Mock SSH, SCP, and network scanning
- **Performance Monitoring**: Mock performance tracking utilities
- **Process Execution**: Mock command line operations and real-time output
- Predictable behavior and fast test execution
- No dependency on actual Electron runtime or external services

## Test Coverage and Reporting

- **V8 Coverage Provider**: Detailed code coverage analysis
- **HTML Reports**: Visual coverage reports in `test-report/` directory
- **Performance Integration**: Performance monitoring within test suites
- **Component Interaction Testing**: Complex workflow and state management testing
- **Filter Management**: Comprehensive filter state and reload functionality testing
- **Network Operations**: Mock file transfer, device discovery, and SSH connectivity testing

## Contributing

When adding new components or pages:
1. Create corresponding test files in the appropriate `__tests__` subdirectory
2. Follow the existing naming convention (`.test.jsx`)
3. Include comprehensive test coverage for user interactions and edge cases
4. Mock all external dependencies (Electron API, file system, network operations, etc.)
5. Add performance monitoring integration where applicable
6. Update this README to reflect new test additions 