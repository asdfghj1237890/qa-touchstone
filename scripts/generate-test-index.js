const fs = require('fs');
const path = require('path');

// HTML content for the redirect file
const indexHtmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Test Report - Redirecting...</title>
    <meta http-equiv="refresh" content="0; url=./test-results.html">
    <script>
        // Fallback JavaScript redirect if meta refresh doesn't work
        window.location.href = './test-results.html';
    </script>
</head>
<body>
    <div style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px;">
        <h2>Redirecting to Test Results...</h2>
        <p>If you are not redirected automatically, <a href="./test-results.html">click here</a>.</p>
    </div>
</body>
</html>`;

// Ensure the test-report directory exists
const testReportDir = path.join(__dirname, '..', 'src', '__tests__', 'test-report');

try {
  // Create directory if it doesn't exist
  if (!fs.existsSync(testReportDir)) {
    fs.mkdirSync(testReportDir, { recursive: true });
  }

  // Write the index.html file
  const indexPath = path.join(testReportDir, 'index.html');
  fs.writeFileSync(indexPath, indexHtmlContent, 'utf8');

  console.log('✅ Generated test report index.html successfully');
} catch (error) {
  console.error('❌ Failed to generate test report index.html:', error.message);
  process.exit(1);
}
