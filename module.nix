{ self }:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.nbt-web;
  pkg = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
in
{
  options.services.nbt-web = {
    enable = lib.mkEnableOption "web-based NBT editor";

    parentDir = lib.mkOption {
      type = lib.types.str;
      default = "/srv/minecraft";
      description = "Directory whose subdirectories are minecraft servers; worlds and players are auto-discovered inside them.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 8585;
      description = "Port to listen on (HTTPS when tlsCertFile/tlsKeyFile are set, otherwise HTTP).";
    };

    tlsCertFile = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "/etc/ssl/tailscale-certs/cert.pem";
      description = "PEM certificate file. Set together with tlsKeyFile to serve HTTPS. Point these at a cert-provisioning service (e.g. a tailscale cert), and add its group to supplementaryGroups so the service can read the key.";
    };

    tlsKeyFile = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "/etc/ssl/tailscale-certs/key.pem";
      description = "PEM private-key file (pairs with tlsCertFile).";
    };

    supplementaryGroups = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      example = [ "certs" ];
      description = "Extra groups for the service — e.g. the group that owns the TLS cert/key.";
    };

    user = lib.mkOption {
      type = lib.types.str;
      default = "minecraft";
      description = "User to run as — needs read/write access to the server files.";
    };

    group = lib.mkOption {
      type = lib.types.str;
      default = "minecraft";
      description = "Group to run as.";
    };

    exposeInterfaces = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ "tailscale0" ];
      description = "Interfaces whose firewall admits the port. The service binds all interfaces; these firewall rules are the access control.";
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = (cfg.tlsCertFile == null) == (cfg.tlsKeyFile == null);
        message = "services.nbt-web: tlsCertFile and tlsKeyFile must be set together.";
      }
    ];

    systemd.services.nbt-web = {
      description = "web-based NBT editor";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];
      serviceConfig = {
        ExecStart =
          "${pkg}/bin/nbt-web --root ${cfg.parentDir} --host 0.0.0.0 --port ${toString cfg.port}"
          + lib.optionalString (cfg.tlsCertFile != null)
            " --tls-cert ${cfg.tlsCertFile} --tls-key ${cfg.tlsKeyFile}";
        User = cfg.user;
        Group = cfg.group;
        SupplementaryGroups = cfg.supplementaryGroups;
        Restart = "on-failure";
        RestartSec = 5;

        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        ReadWritePaths = [ cfg.parentDir ];
        ProtectKernelTunables = true;
        ProtectKernelModules = true;
        ProtectControlGroups = true;
        RestrictSUIDSGID = true;
        LockPersonality = true;
        MemoryDenyWriteExecute = true;
        RestrictAddressFamilies = [
          "AF_INET"
          "AF_INET6"
        ];
      };
    };

    networking.firewall.interfaces = lib.genAttrs cfg.exposeInterfaces (_: {
      allowedTCPPorts = [ cfg.port ];
    });
  };
}
