# Design Document

## Overview

This design extends the k8s-workflows `build_rocks.yaml` workflow to implement Go dependency and build caching. The solution addresses EOF errors encountered when building large Rocks on self-hosted GitHub runners by caching Go modules and build artifacts between workflow runs.

The design leverages GitHub Actions' built-in caching mechanism and integrates with the existing rockcraft container caching strategy. Go caches will be stored on the runner filesystem and mounted into LXD containers where rockcraft executes builds.

## Architecture

### High-Level Flow

1. **Cache Key Generation**: Generate unique cache keys based on Rock metadata and Go dependency files
2. **Cache Restoration**: Restore Go module cache and Go build cache from GitHub Actions cache
3. **Cache Mounting**: Mount restored caches into the LXD container at standard Go cache locations
4. **Build Execution**: Execute rockcraft pack with Go environment variables pointing to mounted caches
5. **Cache Saving**: Save updated Go caches back to GitHub Actions cache (when cache-action permits)

### Integration Points

The Go caching mechanism integrates with existing workflow components:

- **Existing rockcraft container cache**: Go caches complement the container cache; both can be used simultaneously
- **cache-action input**: Respects the existing "save", "restore", "skip" pattern
- **build-env input**: Works alongside custom environment variables
- **multiarch-awareness**: Maintains separate caches per architecture when enabled


## Components and Interfaces

### 1. Workflow Input Parameters

**New Input: `enable-go-caching`**
- Type: boolean
- Default: true
- Description: Enable or disable Go module and build caching
- Usage: Allows users to opt-out of Go caching if needed

### 2. Cache Key Generation

**Go Module Cache Key Format:**
```
{rock-path}/go-mod-cache?name={rock-name}&arch={arch}&gomod={hash(go.mod)}&gosum={hash(go.sum)}&date={YYYY-MM-DD}
```

**Go Build Cache Key Format:**
```
{rock-path}/go-build-cache?name={rock-name}&arch={arch}&gomod={hash(go.mod)}&gosum={hash(go.sum)}&date={YYYY-MM-DD}
```

**Restore Keys (fallback order):**
1. Exact match with current date
2. Match with go.mod/go.sum hash, date from yesterday
3. Match with go.mod/go.sum hash, date from 2 days ago

**Key Components:**
- `rock-path`: Isolates caches per Rock location
- `rock-name`: Isolates caches per Rock name
- `arch`: Isolates caches per architecture (when multiarch-awareness is enabled)
- `gomod/gosum`: Invalidates cache when dependencies change
- `date`: Provides time-based cache rotation

### 3. Cache Storage Locations

**On Runner Filesystem:**
- Go module cache: `~/.go-mod-cache/{rock-name}/`
- Go build cache: `~/.go-build-cache/{rock-name}/`

**Inside LXD Container:**
- Go module cache: `/root/go/pkg/mod/`
- Go build cache: `/root/.cache/go-build/`

### 4. LXD Container Configuration

Rockcraft uses LXD containers for isolated builds. To make Go caches available inside containers, we use LXD disk devices:

**Disk Device Configuration:**
```bash
lxc config device add {container-name} go-mod-cache disk \
  source={runner-cache-path}/go-mod-cache \
  path=/root/go/pkg/mod

lxc config device add {container-name} go-build-cache disk \
  source={runner-cache-path}/go-build-cache \
  path=/root/.cache/go-build
```

### 5. Go Environment Variables

**Environment Variables Set During Build:**
- `GOMODCACHE=/root/go/pkg/mod`: Points Go to the module cache location
- `GOCACHE=/root/.cache/go-build`: Points Go to the build cache location
- `GOPROXY=https://proxy.golang.org,direct`: Configures Go proxy with fallback
- `GOSUMDB=sum.golang.org`: Configures Go checksum database

These variables are passed through the existing `build-env` mechanism and propagated into the LXD container.

## Data Models

### Cache Metadata Structure

```yaml
go-cache-metadata:
  rock-name: string
  rock-path: string
  architecture: string
  go-mod-hash: string
  go-sum-hash: string
  cache-date: string (YYYY-MM-DD)
  cache-size-mb: number
  last-updated: string (ISO 8601)
```

This metadata is stored as environment variables during the workflow run for logging and debugging purposes.


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Cache key uniqueness

*For any* two Rocks with different dependency configurations (different go.mod hash, go.sum hash, rock name, rock path, or architecture), the generated cache keys should be different.

**Validates: Requirements 4.1, 4.2, 5.1, 5.2**

### Property 2: Cache directory population

*For any* Go build that downloads dependencies, the Go module cache directory should contain module files after the build completes, and the Go build cache directory should contain compiled artifacts after the build completes.

**Validates: Requirements 1.2, 2.2**

### Property 3: Cache mount accessibility

*For any* cache contents stored on the runner filesystem, when mounted into the LXD container, those contents should be accessible at the expected container paths (/root/go/pkg/mod for modules, /root/.cache/go-build for build cache).

**Validates: Requirements 1.4, 2.4**

### Property 4: Architecture cache isolation

*For any* Rock built for multiple architectures, each architecture should use a distinct cache key that includes the architecture identifier.

**Validates: Requirements 1.5**

## Error Handling

### Cache Restoration Failures

**Scenario**: GitHub Actions cache restoration fails or times out

**Handling**:
1. Log the cache miss or error
2. Continue with the build using an empty cache
3. Go will download dependencies from proxy.golang.org as normal
4. Build should succeed (may take longer)

**Implementation**: Use `continue-on-error: true` for cache restoration steps or check cache hit status before proceeding.

### Cache Save Failures

**Scenario**: GitHub Actions cache save fails due to size limits or network issues

**Handling**:
1. Log the error
2. Mark the workflow step as failed but don't fail the entire workflow
3. Next build will have a cache miss and rebuild from scratch

**Implementation**: Cache save failures should not block workflow completion since the Rock artifact was successfully built.

### LXD Mount Failures

**Scenario**: LXD disk device mounting fails

**Handling**:
1. Log the mount error
2. Attempt to continue the build without mounted caches
3. If build fails, fail the workflow with clear error message

**Implementation**: Check mount success before proceeding to rockcraft pack.

### Missing go.mod/go.sum Files

**Scenario**: Rock doesn't use Go (no go.mod/go.sum files)

**Handling**:
1. Skip Go cache key generation for dependency hashes
2. Use a generic cache key based on rock name and path only
3. Cache will be less effective but won't cause errors

**Implementation**: Use conditional logic to check for go.mod/go.sum existence before hashing.

### Concurrent Cache Access

**Scenario**: Multiple parallel builds attempt to save caches simultaneously

**Handling**:
1. Use the existing `cache-action` pattern: parallel PR builds use "restore" only
2. Sequential main branch builds use "save" to update caches
3. GitHub Actions cache handles concurrent reads natively
4. Avoid concurrent writes by design

**Implementation**: Document that parallel builds should use `cache-action: restore`.


## Testing Strategy

This feature will be tested using a combination of unit tests and integration tests. Property-based testing will be used where applicable to verify correctness properties across a range of inputs.

### Unit Testing

Unit tests will verify specific behaviors and edge cases:

1. **Cache Key Generation**: Test that cache keys are generated correctly for various input combinations
   - Test with different rock names, paths, architectures
   - Test with and without go.mod/go.sum files
   - Test date formatting in cache keys

2. **Workflow Input Validation**: Test that the `enable-go-caching` input is properly validated and respected

3. **Environment Variable Configuration**: Test that Go environment variables are correctly set based on cache locations

4. **Conditional Logic**: Test that cache steps are skipped when appropriate (e.g., when `enable-go-caching` is false or `cache-action` is "skip")

### Integration Testing

Integration tests will verify the feature works end-to-end in a real GitHub Actions environment:

1. **Cache Restoration and Saving**: Build a Rock, verify cache is saved, build again, verify cache is restored

2. **Multi-Architecture Builds**: Build the same Rock for multiple architectures, verify separate caches are used

3. **Parallel Builds**: Run multiple builds in parallel with `cache-action: restore`, verify all can access caches

4. **Cache Invalidation**: Modify go.mod, verify new cache key is generated and old cache is not used

5. **Integration with Rockcraft Container Cache**: Enable both Go caching and rockcraft container caching, verify both work together

### Property-Based Testing

Property-based tests will verify universal properties hold across many inputs. We will use a shell-based property testing approach since this is primarily a GitHub Actions workflow.

**Testing Framework**: We will use manual property validation through parameterized integration tests that generate varied inputs.

**Test Configuration**: Each property test should run with at least 10 different input combinations to provide reasonable coverage.

**Property Test Annotations**: Each property-based test will include a comment explicitly referencing the correctness property from this design document using the format: `**Feature: go-build-caching, Property {number}: {property_text}**`

### Test Scenarios

1. **Property 1 Test**: Generate cache keys for 10+ different combinations of rock configurations, verify all keys are unique when inputs differ

2. **Property 2 Test**: Build 10+ different Go-based Rocks, verify cache directories are populated after each build

3. **Property 3 Test**: Mount various cache contents into LXD containers, verify accessibility in all cases

4. **Property 4 Test**: Build the same Rock for different architectures, verify cache keys include architecture and are distinct

### Manual Testing

Before release, manually test on self-hosted runners:

1. Build a large Rock (like Cilium) that previously experienced EOF errors
2. Verify first build downloads dependencies and saves cache
3. Verify second build restores cache and completes faster
4. Verify no EOF errors occur during cached builds
5. Monitor cache size and GitHub Actions cache usage

