---
title: "Easy Sandboxing on Linux with Bubblewrap"
date: 2026-08-09T19:51:05+03:00
tags:
- planet-gnome
- distros
summary: |
    I show my script for spawning lightweight temporary sandboxes with Bubblewrap.
---

In these turbulent times, one frequently needs to run some tooling in a sandbox.
The goal is mainly to reduce the blast radius: make it so programs within the sandbox cannot damage the host system (e.g. delete or overwrite something unintended), but also, to a lesser extent, to hide most of the filesystem to avoid exfiltrating sensitive data.

Recently, Bartosz Taudul (of [Tracy](https://github.com/wolfpld/tracy) fame) [showed](https://wolf.nereid.pl/posts/systemd-nspawn/) how to use [systemd-nspawn](https://www.freedesktop.org/software/systemd/man/latest/systemd-nspawn.html) for this purpose.
He creates a container configuration, installs a distro inside, and bind-mounts some cache and project folders from the host.
The mounts have an overlayfs on top, so within the container, tools can write over the files, but those writes do not affect the host filesystem.

I also want to share my sandboxing approach.
My goal was to make it easy to use and reduce friction as much as possible, so that I always have a sandbox at my fingertips.

The result boils down to spawning a container-like environment, sharing enough of the host filesystem read-only to make all host binaries runnable, and sharing the current working directory read-write.
Within this sandbox, you don't need to install a separate distro---everything from your host just works, while the filesystem is kept mostly isolated (except for the folder where you run the sandbox).

For example, I'll run the script in a Tracy checkout.
```
┌ ((8c8d451a)) ~/s/c/tracy
└─ box fish
Welcome to fish, the friendly interactive shell
Type help for instructions on how to use fish
yalter@sandbox ~/s/c/tracy>
```

I can run the build since all my host binaries are accessible:
```
yalter@sandbox ~/s/c/tracy> meson setup build
The Meson build system
Version: 1.11.2
Source dir: /home/yalter/source/cpp/tracy
Build dir: /home/yalter/source/cpp/tracy/build
Build type: native build
Project name: tracy
Project version: 0.13.1
C++ compiler for the host machine: /usr/bin/ccache c++ (clang 22.1.8 "clang version 22.1.8 (AerynOS)")
C++ linker for the host machine: c++ ld.lld 22.1.8
Host machine cpu family: x86_64
Host machine cpu: x86_64
Checking if define "_MSC_VER" exists: NO
Run-time dependency threads found: YES
Found pkg-config: YES (/usr/bin/pkg-config) 2.5.1
Build targets in project: 1

Found ninja-1.13.2 at /usr/bin/ninja
yalter@sandbox ~/s/c/tracy> ninja -C build
ninja: Entering directory `build'
[2/2] Linking target libtracy.so
```

The home folder contains the working directory, and is otherwise mostly empty:
```
yalter@sandbox ~/s/c/tracy> ls -l ~
total 0
drwx------ 4 1000 1000 80 Aug  9 20:20 source/
```

I can write into the home folder, but the write will go into a tmpfs, and will not affect the host system:
```
yalter@sandbox ~/s/c/tracy> touch ~/evil
yalter@sandbox ~/s/c/tracy> ^D
┌ ((8c8d451a)) ~/s/c/tracy
└─ cat ~/evil
cat: /home/yalter/evil: No such file or directory
```

Only changes to the Tracy folder, where I ran the sandbox, persisted on the host, all with correct user ID and everything:
```
┌ ((8c8d451a)) ~/s/c/tracy
└─ ls -l build/
total 28K
drwxr-xr-x 1 yalter yalter   48 Aug  9 20:21 libtracy.so.p
drwxr-xr-x 1 yalter yalter  496 Aug  9 20:21 meson-info
drwxr-xr-x 1 yalter yalter   56 Aug  9 20:21 meson-logs
drwxr-xr-x 1 yalter yalter  310 Aug  9 20:21 meson-private
drwxr-xr-x 1 yalter yalter   40 Aug  9 20:21 meson-uninstalled
-rw-r--r-- 1 yalter yalter 5,3K Aug  9 20:21 build.ninja
-rw-r--r-- 1 yalter yalter  545 Aug  9 20:21 compile_commands.json
-rwxr-xr-x 1 yalter yalter  14K Aug  9 20:21 libtracy.so
```

## The box script

I use [Bubblewrap](https://github.com/containers/bubblewrap) to spawn the sandbox.
This is an unprivileged sandboxing tool used by [Flatpak](https://flatpak.org/) (though, I hear there are plans to replace it with something else).

The script itself composes a long `bwrap` invocation.
Let's look at some of the parts.

```bash
#!/usr/bin/env bash
set -euo pipefail

# Export ALLOW_NET=0 to disable network access inside the sandbox.
#
# Keep in mind that if your X11/Xwayland doesn't check Xauth,
# then network access lets the sandbox connect to your X11
# via an abstract Unix socket. This is quite dangerous.
ALLOW_NET="${ALLOW_NET:-1}"

# The current folder that we're binding read-write.
REPO="$(readlink -f .)"

BWRAP=( bwrap
  --die-with-parent
  # Unshare (isolate) a bunch of things inside the sandbox.
  --unshare-pid
  --unshare-uts
  --unshare-cgroup-try
  --unshare-user-try
  --cap-drop ALL
  # Create/mount important folders.
  --proc /proc
  --dev /dev
  --tmpfs /tmp
  --tmpfs /var
  --dir /run
  --dir /etc
  --hostname sandbox

  # Warning: this script shares all environment variables.
  # If on your system the environment can contain secrets,
  # you may want to clear them:
  # --clearenv

  # Bind the current folder read-write and chdir there.
  --bind "$REPO" "$REPO"
  --chdir "$REPO"
)

# --- Read-only system binds ---
SYS_RO_BINDS=(
  # Folders with binaries and libraries.
  /usr
  /bin
  /sbin
  /lib
  /lib64
  # Random configuration files that programs tend to need.
  /etc/alternatives
  /etc/nsswitch.conf
  /etc/hosts
  /etc/localtime
  /etc/timezone
  /etc/pki
  /etc/ca-certificates
  /etc/ssl
  /etc/crypto-policies
  /etc/fonts
  # I fill these as I bump into problems, more or less.
  /etc/java
  /etc/texlive
  /var/lib/texmf
  /usr/lib/jvm
  /usr/share/java
)
# Bind all of them read-only.
for p in "${SYS_RO_BINDS[@]}"; do
  [[ -e "$p" ]] && BWRAP+=( --ro-bind "$p" "$p" )
done

BWRAP+=( --ro-bind-try /etc/ld.so.cache /etc/ld.so.cache )

# resolv.conf is fun because it's a symlink into /run,
# a folder which we do not want to expose.
RESOLV_REAL="$(readlink -f /etc/resolv.conf 2>/dev/null || true)"
if [[ -n "$RESOLV_REAL" && -f "$RESOLV_REAL" ]]; then
  BWRAP+=( --ro-bind "$RESOLV_REAL" /etc/resolv.conf )
fi

# Unshare the network if needed.
if [[ "$ALLOW_NET" -eq 0 ]]; then
  BWRAP+=( --unshare-net )
fi

# Create a fresh home directory.
# The username and the path is the same as on the host
# so that everything keeps working.
BWRAP+=( --setenv HOME "$HOME"
         --dir "$HOME" )

# --- Home read-only binds ---
HOME_RO_BINDS=(
  .cargo/bin
  .cargo/config.toml
  .local/bin
  .local/lib/node_modules
  .rustup
  .fonts
  .local/share/fonts
  .local/share/nvim/site/parser
  .gitconfig
  .config/git
  .config/tmux
  .cache/ms-playwright
  .cache/corepack
)
for rel in "${HOME_RO_BINDS[@]}"; do
  [[ -e "$HOME/$rel" ]] && BWRAP+=( --ro-bind "$HOME/$rel" "$HOME/$rel" )
done

# --- Home overlays ---
# The sandbox can write here, but the changes
# will not affect the host filesystem.
HOME_TMP_OVERLAYS=(
  .cache/fontconfig
  .cargo/registry
  .cargo/git
  .gradle
  .npm
  .cache/npm
  .local/share/pnpm/store
  .cache/yarn
  .cache/cpm
  .texlive2023
)
for rel in "${HOME_TMP_OVERLAYS[@]}"; do
  [[ -d "$HOME/$rel" ]] && BWRAP+=( --overlay-src "$HOME/$rel" --tmp-overlay "$HOME/$rel" )
done

# Set up $PATH with the paths that we have inside this sandbox.
BWRAP+=( --setenv PATH "$HOME/.cargo/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin" )

# Execute our big commandline and pass it
# the rest of the arguments (the command to run).
CMD=( "${@:-bash}" )
exec "${BWRAP[@]}" "${CMD[@]}"
```

Many lines, but most of them are just listing directories to mount.

If you want to run GUI apps in the sandbox, you'll need to create an `XDG_RUNTIME_DIR` and mount a Wayland socket:

```bash
# Export PASS_WAYLAND=1 to enable Wayland access.
# Warning: it is currently NOT SANDBOXED (e.g. with security-context protocol).
# See https://niri-wm.github.io/niri/Security-Model.html#unsandboxed-clients
# for an example of what that implies.
PASS_WAYLAND="${PASS_WAYLAND:-0}"

# Export PASS_DRI=1 to enable DRI (GPU) access for hardware acceleration.
PASS_DRI="${PASS_DRI:-0}"

# Export PASS_X11=1 to enable X11 (Xwayland) access.
PASS_X11="${PASS_X11:-0}"

if [[ "$PASS_DRI" -eq 1 && -d /dev/dri ]]; then
  BWRAP+=( --dev-bind /dev/dri /dev/dri )
fi

# EGL complains without this.
BWRAP+=( --ro-bind /sys /sys )

# Wayland: bind only the socket into a fresh runtime dir.
XDG_RT="${XDG_RUNTIME_DIR:-}"
WAYLAND_SOCK="${WAYLAND_DISPLAY:-wayland-0}"
if [[ "$PASS_WAYLAND" -eq 1 && -n "$XDG_RT" && -S "$XDG_RT/$WAYLAND_SOCK" ]]; then
  BWRAP+=( --dir /run/user
           --dir /run/user/1000-sbox
           --bind "$XDG_RT/$WAYLAND_SOCK" "/run/user/1000-sbox/$WAYLAND_SOCK"
           --setenv XDG_RUNTIME_DIR /run/user/1000-sbox
           --setenv WAYLAND_DISPLAY "$WAYLAND_SOCK" )
else
  BWRAP+=( --unsetenv WAYLAND_DISPLAY )
fi

# X11.
DISPLAY_VAR="${DISPLAY:-}"
if [[ "$PASS_X11" -eq 1 && -n "$DISPLAY_VAR" && -d /tmp/.X11-unix ]]; then
  BWRAP+=( --ro-bind /tmp/.X11-unix /tmp/.X11-unix
           --setenv DISPLAY "$DISPLAY_VAR" )
else
  # Make it harder for accidental X11: unset DISPLAY.
  BWRAP+=( --unsetenv DISPLAY )
fi
```

That's about it for the script.
If needed, it's easy to mount more folders by adding them into one of the arrays.
The script doesn't require elevated privileges to run.

Just remember that the folder where you run it is mounted read-write with the sandbox.
When I want to run a dangerous command without affecting the files in the repository I'm working on, I just make a temporary copy:
```
project > cd ..
> git clone project project2
> cd project2
project2 > box fish
project2@sandbox > ...some dangerous command...
...
project2@sandbox > ^D
project2 > cd ..
> rm -rf project2
```

Another trick I recently did: I created a read-only GitHub personal access token, and automatically put it into `$GH_TOKEN` in the sandbox.
This way, commands like `gh pr list` work in the sandbox without having any write access.

## Conclusion

This is very much not a polished tool, but rather a script I've been adding on to here and there for several months.
I wanted to share it because I think it's fairly generic (works on both Fedora and [AerynOS](https://aerynos.com/) at least), and avoids a number of pain points with other sandboxing approaches:

- no extra setup required, just one command
- no separate distro installation, uses the host system binaries and libraries directly. As a corollary, anything you build inside this sandbox will work on the host
- no manual folder binding, passes through the current folder
- paths and UID match the host, no broken file permissions
- no sudo needed

One limitation is that I haven't been able to make [podman](https://podman.io/) run inside this sandbox yet.
I tried once briefly, but kept hitting weird errors.
Maybe it needs some capabilities exposed; not sure.

This is also obviously not intended as a bulletproof sandbox for running fully untrusted code, in fact I wouldn't be too surprised if I left some gaping holes by mistake (please let me know if I did).
