const fs = require('fs');
const path = require('path');

const { NDKEvent, NDKPrivateKeySigner, NDKUser } = require('@nostr-dev-kit/ndk');
const NDK = require('@nostr-dev-kit/ndk').default;


const SLEEP_DELAY = 100; // ms delay between actions

// Define a sleep function
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Load bitcoin authors data
let rawdata = fs.readFileSync(path.join(__dirname, 'bitcoin_threads', 'authors_dict.json'));
let authors = JSON.parse(rawdata);

// Load LN authors data
let ln_rawdata = fs.readFileSync(path.join(__dirname, 'lightning_threads', 'authors_dict_ln.json'));
let ln_authors = JSON.parse(ln_rawdata);

// Define relay list
const relays = [
    "wss://eden.nostr.land",
    "wss://nostr.mutinywallet.com",
    "wss://puravida.nostr.land",
    "wss://purplepag.es/",
    "wss://relay.nostrgraph.net/",
    "wss://nostr.bitcoiner.social",
    "wss://no.str.cr",
    "wss://nostr.inosta.cc",
    "wss://nostr.oxtr.dev",
    "wss://relay.nostrati.com",
];

// Load existing keys and flags, if they exist
let keysAndFlags = {};
try {
    keysAndFlags = JSON.parse(fs.readFileSync('keys_and_flags.json'));
} catch (error) {
    console.error(`Failed to load keys_and_flags.json: ${error.message}`);
}

// Create an instance of NDK
const ndk = new NDK({ explicitRelayUrls: relays });

// Get unique authors
const authorsArray = Object.keys(authors);
const authorsArrayLN = Object.keys(ln_authors);
const allAuthors = [...new Set([...authorsArray, ...authorsArrayLN])];

async function processAuthors() {
    await ndk.connect().then(async () => {
        for (let author of allAuthors) {
            // Only process if broadcasted flag is false or undefined
            if (!keysAndFlags[author]?.broadcasted) {
                let signer;
                // If privateKey is present in JSON, use it
                if (keysAndFlags[author]?.privateKey) {
                    signer = new NDKPrivateKeySigner(keysAndFlags[author].privateKey);
                } else {
                    // Generate a new signer for the author
                    signer = NDKPrivateKeySigner.generate();
                }

                // Create an NDK event
                const event = createNDKEvent(author, signer);

                console.log(event)
                //await event.publish();
                
                await sleep(SLEEP_DELAY);

                // Update the keys and flags
                keysAndFlags[author] = {
                    privateKey: signer.privateKey,
                    publicKey: signer._user.npub, 
                    broadcasted: true,
                    relays: relays
                };

                fs.writeFileSync('keys_and_flags.json', JSON.stringify(keysAndFlags));
            } else {
                console.log(`Profile update for ${author} has already been broadcasted. Skipping...`);
            }
        }
    });
}

function createNDKEvent(author, signer) {
    ndk.signer = signer;

    let event = new NDKEvent(ndk);
    event.kind = 0; // 0 for profile event

    // Create event content
    const content = createContent(author);
    event.content = JSON.stringify(content);

    return event;
}

function createContent(author) {
    const firstMessageDate = getFirstMessageDate(author);
    const lastMessageDate = getLastMessageDate(author);
    const totalCountMessages = getTotalCountMessages(author);
    const categories = getCategories(author);

    return {
        name: author + " [ARCHIVE]",
        about: `⚠️ This account is not associated with a real person. It's an archival account for mailing list messages.\n` +
        `🗓️ Active from ${firstMessageDate} to ${lastMessageDate}\n` +
        `💬 Posted a total of ${totalCountMessages} messages\n` +
        `📚 Participated in the following categories: ${categories.join(', ')}\n` +
        `🔇 Please do not DM this user as it's used for archive purposes only.`
    };
}

function getFirstMessageDate(author) {
    return new Date(Math.min(
        (authors[author]?.first_message_date) ? new Date(authors[author].first_message_date) : Infinity,
        (ln_authors[author]?.first_message_date) ? new Date(ln_authors[author].first_message_date) : Infinity
    )).toISOString().split('T')[0];
}

function getLastMessageDate(author) {
    return new Date(Math.max(
        (authors[author]?.last_message_date) ? new Date(authors[author].last_message_date) : -Infinity,
        (ln_authors[author]?.last_message_date) ? new Date(ln_authors[author].last_message_date) : -Infinity
    )).toISOString().split('T')[0];
}

function getTotalCountMessages(author) {
    return (authors[author]?.total_count_messages || 0) + (ln_authors[author]?.total_count_messages || 0);
}

function getCategories(author) {
    return [
        ...new Set(
            (authors[author]?.categories || [])
            .concat(ln_authors[author]?.categories || [])
        )
    ];
}

// Call the async function to process the authors
processAuthors().catch(error => {
    console.error(`Error while processing authors: ${error.message}`);
});
