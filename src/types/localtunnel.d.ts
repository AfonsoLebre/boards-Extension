declare module 'localtunnel' {
  interface TunnelOptions {
    port: number;
    subdomain?: string;
    host?: string;
    local_host?: string;
    local_https?: boolean;
    allow_invalid_cert?: boolean;
    local_ca_cert?: string;
  }

  interface Tunnel {
    url: string;
    on(event: 'close', cb: () => void): void;
    close(): void;
  }

  function localtunnel(options: TunnelOptions): Promise<Tunnel>;
  export = localtunnel;
}