/* Mac package entry point. The pinned kernel is unchanged in opencode-kernel.
 * Set the public plugin configuration and isolate only the initial OSC 11
 * probe from Terminal.app: its immediate reply can deadlock this kernel's
 * renderer before the first frame. Later terminal traffic passes through.
 */
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <mach-o/dyld.h>
#include <signal.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/select.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <termios.h>
#include <time.h>
#include <unistd.h>
#include <util.h>

static volatile sig_atomic_t stopping = 0, resized = 0;
static void on_signal(int s) { if (s == SIGWINCH) resized = 1; else stopping = s; }
static double clock_seconds(void) {
  struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t);
  return (double)t.tv_sec + (double)t.tv_nsec / 1000000000.0;
}
static int write_all(int fd, const void *bytes, size_t length) {
  const char *p = bytes;
  while (length) {
    ssize_t n = write(fd, p, length);
    if (n < 0 && errno == EINTR) continue;
    if (n <= 0) return -1;
    p += n; length -= (size_t)n;
  }
  return 0;
}
static bool directory(const char *p) { struct stat s; return stat(p, &s) == 0 && S_ISDIR(s.st_mode); }
static int join(char *to, const char *root, const char *leaf) {
  int n = snprintf(to, PATH_MAX, "%s/%s", root, leaf);
  return n < 0 || n >= PATH_MAX ? -1 : 0;
}
static void json_string(FILE *f, const char *s) {
  fputc('"', f);
  for (; *s; ++s) {
    unsigned char c = (unsigned char)*s;
    if (c == '"' || c == '\\') { fputc('\\', f); fputc(c, f); }
    else if (c < 32) fprintf(f, "\\u%04x", c);
    else fputc(c, f);
  }
  fputc('"', f);
}
struct probe_filter { size_t pending; bool suppressed; };
static const unsigned char query[] = "\033]11;?\007";
static size_t filter_probe(struct probe_filter *f, const unsigned char *in, size_t n, unsigned char *out) {
  size_t j = 0;
  for (size_t i = 0; i < n; ++i) {
    if (f->suppressed) { out[j++] = in[i]; continue; }
    if (in[i] == query[f->pending]) {
      if (++f->pending == sizeof(query) - 1) { f->suppressed = true; f->pending = 0; }
      continue;
    }
    memcpy(out + j, query, f->pending); j += f->pending; f->pending = 0;
    if (in[i] == query[0]) f->pending = 1;
    else out[j++] = in[i];
  }
  return j;
}
static void report(const char *file, const char *kernel, const char *config, pid_t pid,
                   bool hidden, bool frame, bool home, bool restored, bool timeout,
                   double elapsed, int code) {
  FILE *f = fopen(file, "w"); if (!f) return;
  fprintf(f, "{\n  \"launcher\": \"native-mac-pty\",\n  \"kernel\": "); json_string(f, kernel);
  fprintf(f, ",\n  \"configDirectory\": "); json_string(f, config);
  fprintf(f, ",\n  \"nativePid\": %d,\n  \"backgroundQuerySuppressed\": %s,\n  \"frameSeen\": %s,\n  \"homeFrameSeen\": %s,\n  \"terminalRestored\": %s,\n  \"startupTimedOut\": %s,\n  \"elapsedSeconds\": %.3f,\n  \"exitCode\": %d\n}\n",
          pid, hidden ? "true" : "false", frame ? "true" : "false", home ? "true" : "false",
          restored ? "true" : "false", timeout ? "true" : "false", elapsed, code);
  fclose(f);
}

int main(int argc, char **argv) {
  char executable[PATH_MAX], root[PATH_MAX], kernel[PATH_MAX], config[PATH_MAX],
       workspace[PATH_MAX], state[PATH_MAX], log[PATH_MAX];
  uint32_t size = sizeof(executable);
  if (_NSGetExecutablePath(executable, &size) || !realpath(executable, root)) { perror("launcher path"); return 1; }
  char *slash = strrchr(root, '/'); if (!slash) return 1; *slash = 0;
  if (join(kernel, root, "opencode-kernel") || join(config, root, ".opencode") ||
      join(workspace, root, "workspace") || join(state, root, ".runtime") || join(log, state, "launch.json")) return 1;
  setenv("OPENCODE_CONFIG_DIR", config, 1);
  setenv("OPENCODE_DISABLE_PROJECT_CONFIG", "true", 1);
  setenv("OPENCODE_DISABLE_AUTOUPDATE", "true", 1);
  const char *term = getenv("TERM");
  if (!term || !*term || !strcmp(term, "dumb")) setenv("TERM", "xterm-256color", 1);
  int first = 1;
  const char *project = NULL;
  if (argc > 2 && !strcmp(argv[1], "--project")) { project = argv[2]; first = 3; }
  else if (argc > 1 && directory(argv[1])) { project = argv[1]; first = 2; }
  else if (argc == 1) project = workspace;
  if (project && chdir(project)) { perror(project); return 1; }
  char **args = calloc((size_t)argc + 1, sizeof(char *)); if (!args) return 1;
  args[0] = kernel;
  for (int i = first; i < argc; ++i) args[i - first + 1] = argv[i];
  const char *command = first < argc ? argv[first] : "";
  bool tui = !*command || !strcmp(command, "attach") ||
    (command[0] == '-' && strcmp(command, "--help") && strcmp(command, "-h") && strcmp(command, "--version") && strcmp(command, "-v"));
  if (!tui) { execv(kernel, args); perror(kernel); return 1; }
  struct termios original, raw;
  if (!isatty(0) || !isatty(1) || tcgetattr(0, &original)) {
    fprintf(stderr, "OpenCode TUI needs a foreground terminal. Double-click 启动OpenCode.command or run this executable in Terminal.\n");
    return 2;
  }
  struct winsize dimensions = { .ws_row = 24, .ws_col = 80 };
  (void)ioctl(1, TIOCGWINSZ, &dimensions);
  if (!dimensions.ws_row) dimensions.ws_row = 24;
  if (!dimensions.ws_col) dimensions.ws_col = 80;
  mkdir(state, 0700);
  const char *custom_log = getenv("CODEAGENT_LAUNCH_LOG");
  if (custom_log && *custom_log) snprintf(log, sizeof(log), "%s", custom_log);
  double started = clock_seconds(), stop_at = 0;
  int master, status = 0, result = 1;
  bool frame = false, home = false, timed_out = false, reaped = false;
  struct probe_filter filter = {0};
  pid_t child = forkpty(&master, NULL, NULL, &dimensions);
  if (child < 0) { perror("forkpty"); return 1; }
  if (!child) { execv(kernel, args); perror(kernel); _exit(127); }
  free(args);
  for (int s = 1; s < NSIG; ++s) {
    if (s == SIGINT || s == SIGTERM || s == SIGHUP || s == SIGWINCH) signal(s, on_signal);
  }
  raw = original; cfmakeraw(&raw);
  if (tcsetattr(0, TCSANOW, &raw)) { kill(-child, SIGKILL); waitpid(child, &status, 0); return 1; }
  fcntl(master, F_SETFL, fcntl(master, F_GETFL) | O_NONBLOCK);
  unsigned char input[32768], output[32776], queued[32768];
  size_t queued_size = 0, queued_offset = 0, prompt_match = 0, frame_match = 0;
  const char prompt[] = "Ask anything", frame_end[] = "\033[?2026l";
  report(log, kernel, config, child, false, false, false, false, false, 0, -1);
  while (1) {
    double now = clock_seconds();
    if (!frame && now - started > 25 && !stopping) { timed_out = true; stopping = SIGTERM; }
    if (stopping && !stop_at) { kill(-child, stopping); stop_at = now + 2; }
    if (stop_at && now >= stop_at) kill(-child, SIGKILL);
    if (resized) {
      resized = 0;
      if (!ioctl(1, TIOCGWINSZ, &dimensions) && dimensions.ws_row && dimensions.ws_col) ioctl(master, TIOCSWINSZ, &dimensions);
    }
    fd_set readfds, writefds; FD_ZERO(&readfds); FD_ZERO(&writefds);
    FD_SET(master, &readfds);
    if (!queued_size) FD_SET(0, &readfds); else FD_SET(master, &writefds);
    struct timeval interval = {.tv_sec = 0, .tv_usec = 100000};
    int ready = select(master + 1, &readfds, &writefds, NULL, &interval);
    if (ready < 0 && errno == EINTR) continue;
    if (ready < 0) break;
    if (FD_ISSET(master, &readfds)) {
      ssize_t n = read(master, input, sizeof(input));
      if (n == 0 || (n < 0 && errno == EIO)) break;
      if (n > 0) {
        bool changed = false;
        for (ssize_t i = 0; i < n; ++i) {
          prompt_match = input[i] == (unsigned char)prompt[prompt_match] ? prompt_match + 1 : (input[i] == prompt[0] ? 1 : 0);
          frame_match = input[i] == (unsigned char)frame_end[frame_match] ? frame_match + 1 : (input[i] == (unsigned char)frame_end[0] ? 1 : 0);
          if (prompt_match == sizeof(prompt) - 1) { if (!home) changed = true; home = true; prompt_match = 0; }
          if (frame_match == sizeof(frame_end) - 1) { if (!frame) changed = true; frame = true; frame_match = 0; }
        }
        bool was_hidden = filter.suppressed;
        size_t out = filter_probe(&filter, input, (size_t)n, output);
        if (write_all(1, output, out)) break;
        if (changed || was_hidden != filter.suppressed) report(log, kernel, config, child, filter.suppressed, frame, home, false, false, now - started, -1);
      }
    }
    if (FD_ISSET(0, &readfds)) {
      ssize_t n = read(0, queued, sizeof(queued));
      if (n <= 0) stopping = SIGHUP;
      else { queued_size = (size_t)n; queued_offset = 0; }
    }
    if (queued_size && FD_ISSET(master, &writefds)) {
      ssize_t n = write(master, queued + queued_offset, queued_size);
      if (n > 0) { queued_offset += (size_t)n; queued_size -= (size_t)n; }
      else if (n < 0 && errno != EAGAIN && errno != EINTR && errno != EIO) break;
    }
    if (waitpid(child, &status, WNOHANG) == child) { reaped = true; break; }
  }
  if (!reaped) {
    if (waitpid(child, &status, WNOHANG) != child) { kill(-child, SIGKILL); waitpid(child, &status, 0); }
  }
  close(master);
  tcsetattr(0, TCSANOW, &original);
  const char reset[] = "\033[?2026l\033[?25h\033[0m\033[?1000l\033[?1002l\033[?1003l\033[?1006l\033[?2004l\033[?1049l";
  write_all(1, reset, sizeof(reset) - 1);
  result = timed_out ? 1 : WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
  report(log, kernel, config, child, filter.suppressed, frame, home, true, timed_out, clock_seconds() - started, result);
  if (timed_out) fprintf(stderr, "\nOpenCode startup timed out. Terminal restored. Diagnostics: %s\n", log);
  return result;
}
