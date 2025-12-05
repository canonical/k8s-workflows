# Implementation Plan

- [x] 1. Add workflow input parameter for Go caching control
  - Add `enable-go-caching` boolean input to the workflow with default value `true`
  - Add input validation to ensure it's a boolean value
  - _Requirements: 3.1, 3.4_

- [x] 2. Implement Go cache key generation logic
  - Add step to detect if Rock uses Go (check for go.mod/go.sum files)
  - Generate cache keys for Go module cache including rock name, path, architecture, go.mod hash, go.sum hash, and date
  - Generate cache keys for Go build cache with same components
  - Generate restore keys (fallback keys) for cache misses with date variations
  - Store cache keys in environment variables for use in subsequent steps
  - _Requirements: 4.1, 4.2, 4.5, 5.1, 5.2, 1.5_

- [x] 3. Add Go cache restoration steps
  - Add step to restore Go module cache from GitHub Actions cache (conditional on `enable-go-caching` and `cache-action`)
  - Add step to restore Go build cache from GitHub Actions cache (conditional on `enable-go-caching` and `cache-action`)
  - Add logging to indicate cache hit or miss for both caches
  - Ensure restoration happens before rockcraft pack execution
  - Use `continue-on-error: true` to handle cache restoration failures gracefully
  - _Requirements: 1.1, 2.1, 8.1_

- [x] 4. Configure LXD container to mount Go caches
  - Add step to create cache directories on runner filesystem if they don't exist
  - Add LXD disk device configuration to mount Go module cache into container at `/root/go/pkg/mod`
  - Add LXD disk device configuration to mount Go build cache into container at `/root/.cache/go-build`
  - Ensure mounts are configured before rockcraft pack execution
  - Add error handling for mount failures
  - _Requirements: 1.4, 2.4, 6.3_

- [x] 5. Configure Go environment variables for builds
  - Set `GOMODCACHE=/root/go/pkg/mod` environment variable
  - Set `GOCACHE=/root/.cache/go-build` environment variable
  - Set `GOPROXY=https://proxy.golang.org,direct` environment variable
  - Set `GOSUMDB=sum.golang.org` environment variable
  - Ensure variables are passed through to rockcraft pack command via `sudo -E`
  - Update both "Build rock with Pro features" and "Build rock" steps
  - _Requirements: 1.2, 2.2_

- [x] 6. Add Go cache saving steps
  - Add step to save Go module cache to GitHub Actions cache (conditional on `enable-go-caching` and `cache-action == 'save'`)
  - Add step to save Go build cache to GitHub Actions cache (conditional on `enable-go-caching` and `cache-action == 'save'`)
  - Add logging to indicate cache key being saved
  - Ensure saving happens after successful rockcraft pack execution
  - Use appropriate error handling to not fail workflow if cache save fails
  - _Requirements: 1.3, 2.3, 8.2_

- [x] 7. Implement conditional logic for cache-action input
  - Ensure cache restoration only runs when `cache-action` is "restore" or "save"
  - Ensure cache saving only runs when `cache-action` is "save"
  - Ensure all Go caching steps are skipped when `cache-action` is "skip"
  - Ensure all Go caching steps are skipped when `enable-go-caching` is false
  - _Requirements: 3.2, 3.3, 6.4, 7.4, 7.5_

- [x] 8. Update workflow documentation
  - Document the new `enable-go-caching` input parameter in workflow comments
  - Document the Go caching behavior and cache key structure
  - Document best practices for parallel builds (use `cache-action: restore`)
  - Document cache size considerations and GitHub Actions cache limits
  - Add examples of enabling/disabling Go caching
  - _Requirements: 7.1, 8.3_

- [ ]* 9. Write integration tests for Go caching
  - Create test workflow that builds a Go-based Rock with caching enabled
  - Verify cache is saved after first build
  - Verify cache is restored on second build
  - Verify build completes successfully with cached dependencies
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3_

- [ ]* 10. Write property test for cache key uniqueness
  - **Property 1: Cache key uniqueness**
  - **Validates: Requirements 4.1, 4.2, 5.1, 5.2**
  - Generate cache keys for multiple Rock configurations with varying parameters
  - Verify that different configurations produce different cache keys
  - Test with different rock names, paths, architectures, go.mod hashes, go.sum hashes

- [ ]* 11. Write property test for cache directory population
  - **Property 2: Cache directory population**
  - **Validates: Requirements 1.2, 2.2**
  - Build multiple Go-based Rocks
  - Verify Go module cache directory contains downloaded modules after each build
  - Verify Go build cache directory contains compiled artifacts after each build

- [ ]* 12. Write property test for cache mount accessibility
  - **Property 3: Cache mount accessibility**
  - **Validates: Requirements 1.4, 2.4**
  - Mount various cache contents into LXD containers
  - Verify mounted contents are accessible at expected paths inside containers
  - Test with different cache sizes and file structures

- [ ]* 13. Write property test for architecture cache isolation
  - **Property 4: Architecture cache isolation**
  - **Validates: Requirements 1.5**
  - Build the same Rock for multiple architectures
  - Verify each architecture uses a distinct cache key
  - Verify cache keys include the architecture identifier

- [x] 14. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
