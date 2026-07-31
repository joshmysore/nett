import Foundation
import Contacts

/// Fast read-only Apple Contacts export for Nett.
/// Notes are omitted: CNContact.note requires a restricted entitlement on modern macOS.

let store = CNContactStore()
let keys: [CNKeyDescriptor] = [
  CNContactIdentifierKey as CNKeyDescriptor,
  CNContactGivenNameKey as CNKeyDescriptor,
  CNContactFamilyNameKey as CNKeyDescriptor,
  CNContactNicknameKey as CNKeyDescriptor,
  CNContactOrganizationNameKey as CNKeyDescriptor,
  CNContactJobTitleKey as CNKeyDescriptor,
  CNContactPhoneNumbersKey as CNKeyDescriptor,
  CNContactEmailAddressesKey as CNKeyDescriptor,
  CNContactBirthdayKey as CNKeyDescriptor,
  CNContactPostalAddressesKey as CNKeyDescriptor
]

let semaphore = DispatchSemaphore(value: 0)
var accessError: Error?
store.requestAccess(for: .contacts) { granted, error in
  if !granted {
    accessError = error ?? NSError(
      domain: "Nett",
      code: 1,
      userInfo: [NSLocalizedDescriptionKey: "Contacts access denied"]
    )
  }
  semaphore.signal()
}
_ = semaphore.wait(timeout: .now() + 30)
if let accessError {
  fputs("\(accessError.localizedDescription)\n", stderr)
  exit(1)
}

let request = CNContactFetchRequest(keysToFetch: keys)
var results: [[String: Any]] = []
do {
  try store.enumerateContacts(with: request) { contact, _ in
    let name = [contact.givenName, contact.familyName].filter { !$0.isEmpty }.joined(separator: " ")
    let display = name.isEmpty
      ? (contact.organizationName.isEmpty ? contact.nickname : contact.organizationName)
      : name
    var birthday = ""
    if let components = contact.birthday {
      var dated = components
      dated.calendar = Calendar(identifier: .gregorian)
      if let date = dated.date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]
        birthday = formatter.string(from: date)
      }
    }
    let location: String = {
      guard let address = contact.postalAddresses.first?.value else { return "" }
      return [address.city, address.state, address.country].filter { !$0.isEmpty }.joined(separator: ", ")
    }()
    results.append([
      "sourceId": contact.identifier,
      "name": display,
      "firstName": contact.givenName,
      "lastName": contact.familyName,
      "nickname": contact.nickname,
      "phones": contact.phoneNumbers.map { $0.value.stringValue },
      "emails": contact.emailAddresses.map { String($0.value) },
      "company": contact.organizationName,
      "jobTitle": contact.jobTitle,
      "birthday": birthday,
      "location": location,
      "notes": ""
    ])
  }
} catch {
  fputs("\(error.localizedDescription)\n", stderr)
  exit(2)
}

do {
  let data = try JSONSerialization.data(withJSONObject: results)
  FileHandle.standardOutput.write(data)
} catch {
  fputs("\(error.localizedDescription)\n", stderr)
  exit(3)
}
