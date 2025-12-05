# Requirements Document

## Introduction

This feature extends the k8s-workflows build_rock workflow to implement robust Go dependency caching for building large Rocks on self-hosted GitHub runners. The current workflow experiences EOF (End of File) errors when downloading Go dependencies from proxy.golang.org during builds of large Rocks. This enhancement will implement a caching strategy that stores Go module dependencies between workflow runs, reducing network requests and improving build reliability.

## Glossary

- **Rock**: An OCI (Open Container Initiative) image built using Rockcraft, containing application binaries and dependencies
- **Rockcraft**: A tool for building OCI images (Rocks) in a declarative manner
- **Build Rock Workflow**: The GitHub Actions reusable workflow defined in `.github/workflows/build_rocks.yaml` that builds Rocks
- **Go Module Cache**: The local cache directory where Go stores downloaded module dependencies (typically `$GOMODCACHE` or `$HOME/go/pkg/mod`)
- **Go Build Cache**: The local cache directory where Go stores compiled packages (typically `$GOCACHE` or `$HOME/.cache/go-build`)
- **Self-hosted Runner**: A GitHub Actions runner that executes on infrastructure managed by the repository owner rather than GitHub-hosted infrastructure
- **EOF Error**: An End of File error that occurs when network connections are interrupted during Go dependency downloads
- **LXD Container**: The Linux container environment used by Rockcraft to build Rocks in isolation
- **GitHub Actions Cache**: GitHub's built-in caching mechanism that stores and restores files between workflow runs

## Requirements

### Requirement 1

**User Story:** As a developer building Rocks with Go dependencies, I want Go module dependencies to be cached between builds, so that I can avoid repeated downloads and reduce EOF errors on unreliable networks.

#### Acceptance Criteria

1. WHEN the Build Rock Workflow executes THEN the system SHALL restore the Go module cache from previous builds before starting the Rockcraft build process
2. WHEN Go dependencies are downloaded during a build THEN the system SHALL store them in the Go module cache directory
3. WHEN the Build Rock Workflow completes successfully THEN the system SHALL save the Go module cache for future builds
4. WHEN the Go module cache is restored THEN the system SHALL make the cache available inside the LXD container where Rockcraft executes
5. WHEN multiple architectures are built THEN the system SHALL maintain separate Go caches for each architecture

### Requirement 2

**User Story:** As a developer building Rocks with Go dependencies, I want Go build artifacts to be cached between builds, so that I can speed up compilation and reduce build times.

#### Acceptance Criteria

1. WHEN the Build Rock Workflow executes THEN the system SHALL restore the Go build cache from previous builds before starting the Rockcraft build process
2. WHEN Go packages are compiled during a build THEN the system SHALL store compiled artifacts in the Go build cache directory
3. WHEN the Build Rock Workflow completes successfully THEN the system SHALL save the Go build cache for future builds
4. WHEN the Go build cache is restored THEN the system SHALL make the cache available inside the LXD container where Rockcraft executes

### Requirement 3

**User Story:** As a repository maintainer, I want to control Go caching behavior through workflow inputs, so that I can enable or disable caching based on specific build requirements.

#### Acceptance Criteria

1. WHEN invoking the Build Rock Workflow THEN the system SHALL accept an input parameter to enable or disable Go caching
2. WHEN Go caching is disabled THEN the system SHALL skip all cache restoration and saving steps
3. WHEN Go caching is enabled THEN the system SHALL perform cache restoration before builds and cache saving after builds
4. THE Build Rock Workflow SHALL default to having Go caching enabled

### Requirement 4

**User Story:** As a developer, I want the Go cache to be invalidated when dependencies change, so that I always build with the correct dependency versions.

#### Acceptance Criteria

1. WHEN generating the Go cache key THEN the system SHALL include a hash of the go.mod file
2. WHEN generating the Go cache key THEN the system SHALL include a hash of the go.sum file
3. WHEN the go.mod file changes THEN the system SHALL use a different cache key
4. WHEN the go.sum file changes THEN the system SHALL use a different cache key
5. WHEN an exact cache match is not found THEN the system SHALL attempt to restore from cache keys with matching go.mod and go.sum but different dates

### Requirement 5

**User Story:** As a developer building multiple Rocks in a repository, I want Go caches to be isolated per Rock, so that different Rocks with different Go dependencies do not interfere with each other.

#### Acceptance Criteria

1. WHEN generating the Go cache key THEN the system SHALL include the Rock name
2. WHEN generating the Go cache key THEN the system SHALL include the Rock path
3. WHEN two Rocks have different names THEN the system SHALL use different cache keys
4. WHEN two Rocks are in different paths THEN the system SHALL use different cache keys

### Requirement 6

**User Story:** As a developer, I want the Go cache to work seamlessly with the existing rockcraft container cache, so that both caching mechanisms complement each other without conflicts.

#### Acceptance Criteria

1. WHEN both Go caching and rockcraft container caching are enabled THEN the system SHALL restore both caches before building
2. WHEN both Go caching and rockcraft container caching are enabled THEN the system SHALL save both caches after building
3. WHEN the rockcraft container cache is restored THEN the system SHALL ensure the Go cache is mounted into the container at the correct location
4. WHEN the cache-action input is set to "skip" THEN the system SHALL skip both rockcraft container caching and Go caching

### Requirement 7

**User Story:** As a developer building multiple Rocks in parallel, I want Go caches to be shared across concurrent build jobs, so that all parallel builds can benefit from cached dependencies without waiting for sequential cache saves.

#### Acceptance Criteria

1. WHEN multiple build jobs execute in parallel THEN the system SHALL allow all jobs to restore from the same Go cache
2. WHEN a build job completes and saves the Go cache THEN the system SHALL merge new dependencies with existing cached dependencies
3. WHEN parallel builds download the same Go dependency THEN the system SHALL handle concurrent cache writes without corruption
4. WHEN the cache-action input is set to "restore" THEN the system SHALL only restore caches and SHALL NOT save caches after builds complete
5. WHEN the cache-action input is set to "save" THEN the system SHALL both restore and save caches

### Requirement 8

**User Story:** As a developer, I want clear logging of Go cache operations, so that I can troubleshoot caching issues and verify cache effectiveness.

#### Acceptance Criteria

1. WHEN the Go cache is restored THEN the system SHALL log whether a cache hit or cache miss occurred
2. WHEN the Go cache is saved THEN the system SHALL log the cache key being used
3. WHEN Go cache restoration fails THEN the system SHALL log the error and continue with the build
4. WHEN Go dependencies are downloaded THEN the system SHALL log the download activity
