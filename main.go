// Command dorfwatch runs the local Dorfromantik: Sakura companion server.
package main

import (
	"embed"
	"flag"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"time"

	"dorfwatch/internal/api"
	"dorfwatch/internal/store"
	"dorfwatch/internal/tiles"
)

//go:embed web
var embeddedWeb embed.FS

func main() {
	addr := flag.String("addr", ":8080", "address to listen on; the default accepts connections on any interface")
	dataDir := flag.String("data", "data", "directory holding tiles.json and achievements.json")
	savesDir := flag.String("saves", "saves", "directory holding campaign save files")
	dev := flag.Bool("dev", false, "serve web assets from ./web on disk instead of the embedded copy")
	flag.Parse()

	log.SetFlags(log.Ltime)

	catalog, err := tiles.Load(*dataDir)
	if err != nil {
		log.Fatalf("load tile catalog: %v", err)
	}
	for _, warning := range catalog.Warnings {
		log.Printf("warning: %s", warning)
	}
	log.Printf("loaded %d tile designs (%d achievements) from %s",
		len(catalog.Tiles), len(catalog.Achievements), *dataDir)
	if len(catalog.Tiles) == 0 {
		log.Printf("note: %s/tiles.json is empty — see docs/TILE_DATA.md for the format", *dataDir)
	}

	st, err := store.New(*savesDir)
	if err != nil {
		log.Fatalf("open save store: %v", err)
	}

	webFS, err := webAssets(*dev)
	if err != nil {
		log.Fatalf("open web assets: %v", err)
	}

	srv := &http.Server{
		Addr:              *addr,
		Handler:           api.New(catalog, st, webFS).Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Printf("dorfwatch listening on %s", *addr)
	for _, url := range listenURLs(*addr) {
		log.Printf("  %s", url)
	}
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}

// listenURLs lists the addresses the server can be reached on, so a tablet on
// the same network knows what to open.
func listenURLs(addr string) []string {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return []string{"http://" + addr}
	}
	if host != "" && host != "0.0.0.0" && host != "::" {
		return []string{"http://" + net.JoinHostPort(host, port)}
	}

	urls := []string{"http://" + net.JoinHostPort("localhost", port)}
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return urls
	}
	for _, a := range addrs {
		ipNet, ok := a.(*net.IPNet)
		if !ok || ipNet.IP.IsLoopback() {
			continue
		}
		if ip4 := ipNet.IP.To4(); ip4 != nil {
			urls = append(urls, "http://"+net.JoinHostPort(ip4.String(), port))
		}
	}
	return urls
}

// webAssets returns the filesystem holding the client app, rooted so that
// index.html sits at the top.
func webAssets(dev bool) (fs.FS, error) {
	if dev {
		return os.DirFS("web"), nil
	}
	return fs.Sub(embeddedWeb, "web")
}
