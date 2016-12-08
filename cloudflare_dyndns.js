/**
 * This script will automatically update a CloudFlare-hosted DNS entry with your current local IP address.
 * Useful as a dynamic DNS host.
 */

const CF_EMAIL = "";                 // Your CloudFlare account email
const CF_KEY = "";                   // Your CloudFlare API key
const DOMAIN = "";                   // The domain you wish to point to your local IP       
const DNS_TTL = 120;                 // TTL for your subdomain

// DO NOT EDIT BELOW THIS LINE

var Https = require('https');

console.log("Getting local IPv4 address from ipv4.icanhazip.com...");
Https.get("https://ipv4.icanhazip.com", (res) => {
	if (res.statusCode != 200) {
		throw new Error("HTTP error " + res.statusCode + " from icanhazip.com");
	}
	
	if (!res.headers['content-type'] || !res.headers['content-type'].match(/^text\/plain($|;)/)) {
		throw new Error("Missing or bad content-type " + res.headers['content-type'] + " from icanhazip.com");
	}
	
	var data = "";
	res.on('data', (chunk) => data += chunk);
	res.on('end', () => {
		data = data.trim();
		if (!data.match(/^(\d{1,3}\.){3}\d{1,3}$/)) {
			throw new Error("Malformed response data " + data + " from icanhazip.com");
		}
		
		var localIp = data;
		
		console.log("Local IP is " + localIp);
		console.log("Listing CloudFlare zones...");
		
		var domainPortions = [];
		var domainParts = DOMAIN.split('.');
		for (var i = domainParts.length - 2; i >= 0; i--) {
			domainPortions.push(domainParts.slice(i).join('.'));
		}
		
		cloudflare("GET", "/zones", (res) => {
			var zone = null;
			
			for (var i = 0; i < res.length; i++) {
				if (domainPortions.indexOf(res[i].name) != -1) {
					zone = res[i].id;
					break;
				}
			}
			
			if (!zone) {
				throw new Error("Cannot find zone matching domain");
			}
			
			console.log("Got zone ID: " + zone);
			console.log("Listing DNS records for zone...");
			
			cloudflare("GET", "/zones/" + zone + "/dns_records?name=" + DOMAIN, (res) => {
				if (res.length == 0) {
					console.log("No DNS record found; creating one...");
					createRecord(zone, localIp);
				} else if (res[0].content == localIp) {
					console.log("DNS record for " + DOMAIN + " is already current IP " + localIp + "; exiting");
					return;
				} else {
					console.log("Updating existing DNS record " + res[0].id + "...");
					updateRecord(zone, res[0].id, localIp);
				}
			});
		});
	});
});

function createRecord(zoneId, localIp) {
	cloudflare("POST", "/zones/" + zoneId + "/dns_records", {"type": "A", "name": DOMAIN, "content": localIp}, (res) => {
		console.log("DNS record " + res.id + " created for domain " + DOMAIN + " with IP " + localIp);
	});
}

function updateRecord(zoneId, recordId, localIp) {
	cloudflare("PUT", "/zones/" + zoneId + "/dns_records/" + recordId, {"type": "A", "name": DOMAIN, "content": localIp}, (res) => {
		console.log("DNS record " + res.id + " updated for domain " + DOMAIN + " with IP " + localIp);
	});
}

function cloudflare(method, endpoint, data, callback) {
	if (typeof data === 'function') {
		callback = data;
		data = {};
	}
	
	var headers = {"X-Auth-Email": CF_EMAIL, "X-Auth-Key": CF_TOKEN};
	if (method != "GET") {
		headers['Content-Type'] = "application/json";
	}
	
	Https.request({
		"method": method,
		"hostname": "api.cloudflare.com",
		"port": 443,
		"path": "/client/v4" + endpoint,
		"headers": headers
	}, (res) => {
		if (res.statusCode != 200) {
			throw new Error("HTTP error " + res.statusCode + " from CloudFlare");
		}
		
		var data = "";
		res.on('data', (chunk) => data += chunk);
		res.on('end', () => {
			data = JSON.parse(data);
			if (!data.success) {
				if (data.errors && data.errors.length > 0) {
					throw new Error(data.errors.join(', '));
				} else {
					throw new Error("Non-success from CloudFlare");
				}
			}
			
			callback(data.result);
		});
	}).end(method == "GET" ? null : JSON.stringify(data));
}
