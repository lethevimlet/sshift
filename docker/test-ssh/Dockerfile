# Test fixture: OpenSSH server for sshift integration tests.
#
# Uses the lightweight `linuxserver/openssh-server` image which already
# handles key generation, PAM, and sshd supervision. We only need to:
#  - create a test user with a known password,
#  - expose port 22,
#  - keep the default host key + password auth enabled.
#
# The credentials are intentionally fixed: they only have meaning inside
# the integration-test fixture container which is destroyed at the end
# of the test run. No real workload ever lands here.

FROM lscr.io/linuxserver/openssh-server:9.7_p1-r0-ls29

# LinuxServer image reads these env vars at first-boot:
#   USER_PASSWORD — login password for the user account
#   USER_NAME      — account name to create
#   PASSWORD_ACCESS — "true" to allow password auth (disabled by default)
#   PUID/PGID      — run user with this uid/gid (defaults to 1000)
ARG TEST_USER=testuser
ARG TEST_PASS=testpass
ENV USER_NAME=${TEST_USER}
ENV USER_PASSWORD=${TEST_PASS}
ENV PASSWORD_ACCESS=true
ENV PUID=1000
ENV PGID=1000

# LinuxServer's openssh-server image exposes 2222 by default. Map
# container:2222 → host:2222 in the compose file (or below).
EXPOSE 2222

# A healthcheck so Jest's globalSetup can wait for readiness via the
# /config/openssh/openshd process. We probe the port directly because
# the container's `healthcheck` script from LinuxServer polls
# https://www.healthchecks.io by default (which is the opposite of what
# we want for an offline CI).
HEALTHCHECK --interval=2s --timeout=2s --start-period=3s --retries=30 \
    CMD nc -z 127.0.0.1 2222 || exit 1