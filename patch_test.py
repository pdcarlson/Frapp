import sys

file_path = 'apps/api/src/application/services/chapter.service.spec.ts'

with open(file_path, 'r') as f:
    content = f.read()

search = """    expect(mockStorageProvider.deleteFile).not.toHaveBeenCalled();
    expect(mockChapterRepo.update).toHaveBeenCalledWith('ch-1', {
      logo_path: null,
    });
    expect(result.logo_path).toBeNull();
  });
});"""

replace = """    expect(mockStorageProvider.deleteFile).not.toHaveBeenCalled();
    expect(mockChapterRepo.update).toHaveBeenCalledWith('ch-1', {
      logo_path: null,
    });
    expect(result.logo_path).toBeNull();
  });

  it('should throw NotFoundException when chapter to delete logo from is not found', async () => {
    mockChapterRepo.findById.mockResolvedValue(null);

    await expect(service.deleteLogo('ch-1')).rejects.toThrow(NotFoundException);
  });
});"""

if search in content:
    with open(file_path, 'w') as f:
        f.write(content.replace(search, replace))
    print("Success")
else:
    print("Search string not found")
