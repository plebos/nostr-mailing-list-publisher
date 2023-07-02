import json
import uuid
import requests
from bs4 import BeautifulSoup
from datetime import datetime
import re
from dateutil.relativedelta import relativedelta
import os


LIST_CHOOSER = 'bitcoin'

os.chdir(f"{LIST_CHOOSER}_threads")
#MAILING_LIST_URL = r"https://lists.linuxfoundation.org/pipermail/lightning-dev"
MAILING_LIST_URL = f"https://lists.linuxfoundation.org/pipermail/{LIST_CHOOSER}-dev"


def get_years_and_months():
    url = MAILING_LIST_URL
    response = requests.get(url)
    soup = BeautifulSoup(response.text, 'html.parser')

    month_year_elements = soup.select('tr td:nth-of-type(1)')
    month_year_strings = [el.text for el in month_year_elements]

    month_year_tuples = []
    for month_year in month_year_strings:
        split_month_year = month_year.strip(':').split()
        if len(split_month_year) == 2:  # Some strings might not be a month and a year
            month, year = split_month_year
            month_year_tuples.append((month, year))

    return month_year_tuples

def filter_recent_months(month_year_tuples):
    # Get current year and month
    now = datetime.now()
    current_year = now.year
    current_month = now.month

    # Calculate last month and year
    last_month = current_month - 1 if current_month > 1 else 12
    last_year = current_year if current_month > 1 else current_year - 1

    # Filter out months that aren't current or last month
    recent_month_year_tuples = []
    for month, year in month_year_tuples:
        # Convert month name to its number
        month_num = datetime.strptime(month, "%B").month
        year = int(year)

        if ((year, month_num) != (last_year, last_month)) and ((year, month_num) != (current_year, current_month)):
            continue
        recent_month_year_tuples.append((month, year))

    return recent_month_year_tuples

def get_message_info(thread_soup):
    message_author = thread_soup.find('b').text.strip()
    message_date_str = thread_soup.find('i').text.strip()
    message_date = datetime.strptime(message_date_str, '%a %b %d %H:%M:%S %Z %Y')
    message_text_element = thread_soup.find('pre')
    message_text = message_text_element.text.strip() if message_text_element else ''
    return message_author, message_date, message_text

def get_thread_summary(thread):
    authors = list(set([message['author'] for message in thread['thread_messages']]))
    total_chars = sum(len(message['message_text_only']) for message in thread['thread_messages'])
    categories = re.findall(r'\[(.*?)\]', thread['title'])
    title = re.sub(r'\[(.*?)\]\s*', '', thread['title'])
    return {
        'title': title,
        'categories': categories,
        'authors': authors,
        'messages_count': len(thread['thread_messages']),
        'total_messages_chars_count': total_chars
    }

def process_month(year, month):
    months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    base_url = f'{MAILING_LIST_URL}/{year}-{months[month-1]}/'
    print(f"Processing URL: {base_url}")

    index_url = base_url + 'thread.html'
    index_response = requests.get(index_url)
    index_soup = BeautifulSoup(index_response.text, 'html.parser')

    threads_dict = {}
    for li in index_soup.find_all('li'):
        if 'sorted by:' in li.text:
            continue
        a = li.find('a')
        if a is not None and '.html' in a['href']:
            thread_title = a.text.strip().replace('\t', ' ')
            thread_link = base_url + a['href']

            print(f"Processing thread: '{thread_title}'")
            thread_response = requests.get(thread_link)
            thread_soup = BeautifulSoup(thread_response.text, 'html.parser')
            message_author, message_date, message_text = get_message_info(thread_soup)

            if thread_title not in threads_dict:
                threads_dict[thread_title] = {
                    'title': thread_title,
                    'id': str(uuid.uuid4()),  # Add a unique ID to each thread
                    'thread_messages': []
                }

            threads_dict[thread_title]['thread_messages'].append({
                'id': str(uuid.uuid4()),  # Add a unique ID to each thread
                'author': message_author,
                'date': message_date,
                'message_text_only': message_text
            })

    for thread in threads_dict.values():
        for message in thread['thread_messages']:
            message['date'] = message['date'].isoformat()

    # Load existing data
    filename = f'{LIST_CHOOSER}_dev_{year}_{month:02d}.json'
    if os.path.exists(filename):
        with open(filename, 'r', encoding='utf-8') as f:
            existing_data = json.load(f)
    else:
        existing_data = []

    # Create a dictionary of existing threads
    existing_threads = {thread['title']: thread for thread in existing_data}

    for thread_title, thread in threads_dict.items():
        # If the thread already exists, append only new messages
        if thread_title in existing_threads:
            existing_messages = existing_threads[thread_title]['thread_messages']
            existing_identifiers = {(m['author'], m['date']) for m in existing_messages}

            new_messages = []
            for message in thread['thread_messages']:
                identifier = (message['author'], message['date'])
                if identifier not in existing_identifiers:
                    message['new'] = True
                    new_messages.append(message)

            existing_messages += new_messages
            # Recalculate the summary only if there are new messages
            if new_messages:
                existing_threads[thread_title]['thread_summary'] = get_thread_summary({'title': thread_title, 'thread_messages': existing_messages})
            
            existing_threads[thread_title]['thread_messages'] = existing_messages
            existing_threads[thread_title]['has_new_messages'] = bool(new_messages)
            thread['new'] = False
        # Otherwise, add the entire new thread
        else:
            thread['thread_summary'] = get_thread_summary(thread)
            thread['has_new_messages'] = True
            thread['new'] = True
            for message in thread['thread_messages']:
                message['new'] = True
            existing_threads[thread_title] = thread

    new_data = list(existing_threads.values())

    json_data = json.dumps(new_data, indent=4)
    with open(filename, 'w') as f:
        print(f"Saving data to {LIST_CHOOSER}_threads/{filename}")
        f.write(json_data)

month_year_tuples = get_years_and_months()

recent_month_year_tuples = filter_recent_months(month_year_tuples)
print(recent_month_year_tuples)

for month, year in recent_month_year_tuples:
    month = datetime.strptime(month, "%B").month  # Convert month name to month number
    print(year, month)
    process_month(year, month)
