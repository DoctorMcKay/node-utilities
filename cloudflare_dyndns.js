/**
 * This script will automatically update a Cloudflare-hosted DNS entry with your current local IP address.
 * Useful as a dynamic DNS host.
 */

const CF_EMAIL = "";                 // Your Cloudflare account email
const CF_KEY = "";                   // Your Cloudflare API key
const DOMAIN = "";                   // The domain you wish to point to your local IP       
const DNS_TTL = 120;                 // TTL for your subdomain

// DO NOT EDIT BELOW THIS LINE

const DNS = require('dns');
const HTTPS = require('https');

main();
async function main() {
	let localIp = await getMyIp();
	console.log(`Local IPv4 address is ${localIp}`);
	
	let domainIp = await resolve4(DOMAIN);
	console.log(`${DOMAIN} points to ${domainIp[0] || 'NOWHERE'}`);
	
	if (domainIp.length == 1 && localIp == domainIp[0]) {
		console.log(`${DOMAIN} already points to our local IP; exiting`);
		return;
	}
	
	
	console.log('Listing Cloudflare zones...');
	
	var domainPortions = [];
	var domainParts = DOMAIN.split('.');
	for (var i = domainParts.length - 2; i >= 0; i--) {
		domainPortions.push(domainParts.slice(i).join('.'));
	}
	
	let zones = await cloudflare('GET', '/zones');
	let zone = zones.find(z => domainPortions.includes(z.name));
	
	if (!zone) {
		throw new Error(`Cannot find a zone matching ${DOMAIN} in your Cloudflare account`);
	}
	
	let zoneId = zone.id;
	console.log(`Found zone ID: ${zoneId}`);
	console.log('Listing DNS records for zone...');
	
	let dnsRecords = await cloudflare('GET', `/zones/${zoneId}/dns_records?name=${DOMAIN}`);
	if (dnsRecords.length == 0) {
		console.log('No DNS record found; creating one...');
		await createRecord(zoneId, localIp);
	} else if (dnsRecords[0].content == localIp) {
		// This shouldn't really happen since we check via DNS early, but maybe there's some caching going on
		console.log(`DNS record for ${DOMAIN} is already current IP ${localIp}; exiting`);
		return;
	} else {
		console.log(`Updating existing DNS record ${dnsRecords[0].id}...`);
		await updateRecord(zoneId, dnsRecords[0].id, localIp);
	}
}

async function createRecord(zoneId, localIp) {
	let record = await cloudflare('POST', `/zones/${zoneId}/dns_records`, {type: 'A', name: DOMAIN, content: localIp});
	console.log(`DNS record ${record.id} created for domain ${DOMAIN} with IP ${localIp}`);
}

async function updateRecord(zoneId, recordId, localIp) {
	let record = await cloudflare('PUT', `/zones/${zoneId}/dns_records/${recordId}`, {type: 'A', name: DOMAIN, content: localIp});
	console.log(`DNS record ${record.id} updated for domain ${DOMAIN} with IP ${localIp}`);
}

function cloudflare(method, endpoint, data) {
	return new Promise((resolve, reject) => {
		let headers = {'X-Auth-Email': CF_EMAIL, 'X-Auth-Key': CF_KEY};
		if (method != 'GET') {
			headers['Content-Type'] = 'application/json';
		}
		
		HTTPS.request({
			method,
			hostname: 'api.cloudflare.com',
			port: 443,
			path: '/client/v4' + endpoint,
			headers
		}, (res) => {
			if (res.statusCode != 200) {
				return reject(new Error(`HTTP error ${res.statusCode} from Cloudflare`));
			}
			
			var data = '';
			res.on('data', (chunk) => data += chunk);
			res.on('end', () => {
				data = JSON.parse(data);
				if (!data.success) {
					if (data.errors && data.errors.length > 0) {
						return reject(new Error(data.errors.join(', ')));
					} else {
						return reject(new Error('Non-success from Cloudflare'));
					}
				}
				
				resolve(data.result);
			});
		}).end(method == 'GET' ? null : JSON.stringify(data));
	});
}

function resolve4(domain) {
	return new Promise((resolve, reject) => {
		let resolver = new DNS.Resolver();
		resolver.setServers(['1.1.1.1', '1.0.0.1']); // manually specify resolvers to avoid any local caches
		resolver.resolve4(domain, (err, addresses) => {
			if (err) {
				if (err.code == 'ENODATA') {
					return resolve([]);
				}
				
				return reject(err);
			}
			
			resolve(addresses);
		});
	});
}

function getMyIp() {
	return new Promise(async (resolve, reject) => {
		let resolver = new DNS.Resolver();
		resolver.setServers(await resolve4('resolver1.opendns.com'));
		resolver.resolve4('myip.opendns.com', (err, addresses) => {
			if (err) return reject(err);
			if (addresses.length == 0) {
				return reject(new Error('No IP found'));
			}
			
			resolve(addresses[0]);
		});
	});
}
