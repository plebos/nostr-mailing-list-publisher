import json
import os
import re
import time
from datetime import datetime
import openai
from dotenv import load_dotenv
import os
import random 


LIST_CHOOSER = 'bitcoin'
AUTHORS_JSON_FILE_NAME = "authors_dict_ln.json" if LIST_CHOOSER == 'lightning' else "authors_dict.json"


load_dotenv()  # take environment variables from .env
openai.api_key = os.getenv('OPENAI_API_KEY', "")
os.chdir(f"{LIST_CHOOSER}_threads")

def exponential_backoff_retry(api_func, *args, **kwargs):
    """Exponential backoff retry mechanism"""
    max_retry_count = 5
    retry_count = 0

    while retry_count < max_retry_count:
        try:
            response = api_func(*args, **kwargs)
            return response
        except (openai.error.RateLimitError, openai.error.OpenAIError) as e:
            wait_time = (2 ** retry_count) + random.random()
            print(f"Exception caught: {str(e)}. Retrying in {wait_time} seconds.")
            time.sleep(wait_time)
            retry_count += 1

    raise Exception("Max retry limit exceeded.")

def get_json_filenames():
    json_files = [pos_json for pos_json in os.listdir() if pos_json.endswith('.json') and re.match(f'{LIST_CHOOSER}' + '_dev_[0-9]{4}_[0-9]{2}.json', pos_json)]
    return sorted(json_files, key=lambda x: datetime.strptime(x, f'{LIST_CHOOSER}_dev_%Y_%m.json'))

def get_date_range(thread_messages):
    dates = [datetime.fromisoformat(message['date']).date() for message in thread_messages]
    min_date, max_date = min(dates), max(dates)
    if min_date == max_date:
        return min_date.strftime('%Y-%m-%d')
    else:
        return f"{min_date.strftime('%Y-%m-%d')} to {max_date.strftime('%Y-%m-%d')}"

def read_and_print_json_info(json_file, authors_dict):
    year_month = json_file[-12:-5]
    year = int(year_month.split("_")[0])
    print(f"Year-Month: {year_month}")

    # Backup the original file
    backup_file = json_file[:-5] + "_backup.json"
    os.replace(json_file, backup_file)

    # Read data from the backup file
    with open(backup_file, 'r', encoding='utf-8') as f:
        data = json.load(f)

    for thread in data:
        # Only generate summaries for "new" threads and threads that have new messages
        if not thread.get("new", False) and not thread.get("has_new_messages", False):
            continue

        print(f"\nThread Title: {thread['thread_summary']['title']}")
        print(f"Categories: {', '.join(thread['thread_summary']['categories'])}")
        print(f"Thread Dates: {get_date_range(thread['thread_messages'])}")
        print(f"Thread Participants: {', '.join(thread['thread_summary']['authors'])}")

        summaries = []
        for message in thread['thread_messages']:
            if not message.get('new', False):
                if 'summary' in message:
                    summaries.append({"author": message['author'], "summary": message["summary"]});
                continue

            author = message['author']
            message_date = datetime.fromisoformat(message['date']).date()
            print(f"\t- {author}")

            # Update authors dictionary
            if author not in authors_dict:
                authors_dict[author] = {
                    'first_message_date': message_date.strftime('%Y-%m-%d'),
                    'last_message_date': message_date.strftime('%Y-%m-%d'),
                    'total_count_messages': 1,
                    'categories' : []
                }
            else:
                authors_dict[author]['last_message_date'] = max(authors_dict[author]['last_message_date'], message_date.strftime('%Y-%m-%d'))
                authors_dict[author]['first_message_date'] = min(authors_dict[author]['first_message_date'], message_date.strftime('%Y-%m-%d'))
                authors_dict[author]['total_count_messages'] += 1
                for category in thread["thread_summary"]["categories"]:
                    if category not in authors_dict[author]['categories']:
                        authors_dict[author]['categories'].append(category)
                        
            if 'summary' in message or year not in [2011, 2023]:
                continue  # Skip this message if it already has a summary

            full_prompt = "Please provide the best 25 words summary for that text:" + message['message_text_only'][:3000]
            messages = [
                {"role": "system", "content": "You are a professional summarizer"},
                {"role": "user", "content": full_prompt},
            ]

            while True:
                try:
                    # Usage:
                    response = exponential_backoff_retry(openai.ChatCompletion.create, model="gpt-3.5-turbo", messages=messages, max_tokens=1000, temperature=0.1)
                    break
                except openai.error.RateLimitError:
                    time.sleep(3)  # Wait 3 seconds before trying again

            answer = str(response.choices[0].message.content)
            print(message['author'] + ":" + answer)
            summaries.append({"author": author, "summary": answer})

            message['summary'] = answer  # Add summary field to message

            with open(json_file, 'w') as f:
                json.dump(data, f)
        
        if year not in [2011, 2023]:
            continue  # Skip this thread if it already has a convo_summary
            
        #with open(extended_json_file, 'w') as f:  # Save changes after each message summary to extended file
            #json.dump(data, f)
        
        # After processing each thread, write the entire data back to the original file


        if len(summaries) > 1:
            summaries_chat = "\\n".join(i["author"] + ":" + i["summary"] for i in summaries)
            full_prompt = "Please create the best summary of 50 words total from that summarized convo:" + summaries_chat[:4000]
            messages = [
                {"role": "system", "content": f"You are a professional convo summarizer"},
                {"role": "user", "content": full_prompt},
            ]

            while True:
                try:
                    response = exponential_backoff_retry(openai.ChatCompletion.create, model="gpt-3.5-turbo", messages=messages, max_tokens=1000, temperature=0.1)
                    break
                except openai.error.RateLimitError:
                    time.sleep(3)  # Wait 3 seconds before trying again

            answer = str(response.choices[0].message.content)
            print("Convo_summary:" + answer)

            thread['thread_summary']['convo_summary'] = answer  # Add convo_summary field to thread_summary

            #with open(extended_json_file, 'w') as f:  # Save changes after each thread summary to extended file
                #json.dump(data, f)
                # After processing each thread, write the entire data back to the original file
            with open(json_file, 'w') as f:
                json.dump(data, f)

    # Make sure the file is written even when there's no thread to update
    with open(json_file, 'w') as f:
        json.dump(data, f)

if __name__ == "__main__":
    authors_dict = {}

    if os.path.exists(AUTHORS_JSON_FILE_NAME):
        with open(AUTHORS_JSON_FILE_NAME, "r") as infile:
            authors_dict = json.load(infile)

    json_files = get_json_filenames()
    print(json_files)

    for json_file in json_files:
        read_and_print_json_info(json_file, authors_dict)

    with open(AUTHORS_JSON_FILE_NAME, "w") as outfile:
        json.dump(authors_dict, outfile)
    
    #print("\nAuthors Data:")
    #for author, data in authors_dict.items():
    #    print(f"{author}:\n\tFirst Message Date: {data['first_message_date']}\n\tLast Message Date: {data['last_message_date']}\n\tTotal Count Messages: {data['total_count_messages']}")
