
/* TODO add cli options and flags


--name <name> (matching text or wildcard)
--file <file> (matching file name text or wildcard; is a test suite by default)

Essential test CLI options and flags vary significantly depending on the specific testing framework or tool being used. However, common categories of options and flags found across many testing CLIs include:
Execution Control:

    Running specific tests:
        --test-name <name> or similar: Executes a single test or a group of tests matching a pattern.
        --grep <pattern>: Filters tests based on a regular expression pattern in their names.
        --file <path>: Runs tests only from specified files. 
    Controlling execution flow:
        --fail-fast or --first: Stops test execution immediately upon the first failure.
        --bail: Similar to fail-fast, often with more granular control over how many failures are tolerated before stopping.
        --retries <n>: Reruns failed tests a specified number of times. 

Output and Reporting:

    Verbosity levels:
        --verbose or -v: Provides more detailed output during test execution.
        --quiet or -q: Suppresses most output, showing only essential information like summaries. 
    Reporting formats:
        --reporter <format>: Specifies the output format for test results (e.g., json, junit, html).
        --output <file>: Redirects test output to a specified file. 
    Code coverage:
        --coverage: Enables code coverage analysis and reporting.
        --coverage-report <format>: Specifies the format for coverage reports. 

Configuration and Setup:

    Configuration files:
        --config <file>: Specifies an alternative configuration file for the test runner. 
    Environment variables:
        --env <key=value>: Sets environment variables for the test process. 
    Setup/Teardown scripts:
        --pre-flight <script>: Runs a script or command before any tests execute.
        --post-flight <script>: Runs a script or command after all tests have completed. 

Debugging and Development:

    Debugging tools:
        --inspect or --debug: Enables debugging features, often allowing attachment of a debugger.
        --watch: Reruns tests automatically when relevant files change.
*/