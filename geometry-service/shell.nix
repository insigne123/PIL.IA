
{ pkgs ? import <nixpkgs> {} }:
pkgs.mkShell {
  # Packages to include in the environment
  buildInputs = [
    pkgs.python311
    pkgs.python311Packages.virtualenv
    pkgs.python311Packages.pip
    # System libraries required by binary wheels (numpy, opencv, etc.)
    pkgs.stdenv.cc.cc.lib
    pkgs.glib
    pkgs.zlib
  ];

  # Hook to set LD_LIBRARY_PATH dynamically so wheels can find the .so files
  shellHook = ''
    export LD_LIBRARY_PATH=${pkgs.stdenv.cc.cc.lib}/lib:$LD_LIBRARY_PATH
    export LD_LIBRARY_PATH=${pkgs.glib.out}/lib:$LD_LIBRARY_PATH
    export LD_LIBRARY_PATH=${pkgs.zlib}/lib:$LD_LIBRARY_PATH
    echo "==================================================="
    echo "  Nix Environment with Library Fixes Loaded! 🚀  "
    echo "==================================================="
  '';
}
